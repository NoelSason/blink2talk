import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATEGORIES, completeWord, condense, fallbackReplies, getReplies, getStarters, summarize, type Category, type PastRequest } from "./claude.js";
import { localModelAvailable, warmLocal } from "./local.js";
import { CONSENT_REPLIES, SPELL_OPTION, URGENT } from "./safety.js";
import { sttToken, synthesize, usingClone, warm } from "./voice.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(here, "../public")));

const mockVoice = () => process.env.MOCK_VOICE === "1" || !process.env.CARTESIA_API_KEY;

app.get("/config", (_req, res) => {
  res.json({
    urgent: URGENT,
    spellOption: SPELL_OPTION,
    categories: CATEGORIES, // second "none of these": pain, comfort, people, question
    mockReplies: process.env.MOCK_REPLIES === "1" || !process.env.ANTHROPIC_API_KEY,
    mockVoice: mockVoice(),
    clonedVoice: usingClone(),
    localModel: localModelAvailable(), // testing only: the small on-laptop model is downloaded
  });
});

// Always responds: on any model failure, falls back to safe generic options.
app.post("/replies", async (req, res) => {
  const { transcript, history, patientProfile, fatigue, speaker, local, rejected, category, earlier, now } = req.body ?? {};
  if (typeof transcript !== "string" || !transcript.trim()) {
    res.status(400).json({ error: "transcript required" });
    return;
  }
  const t0 = Date.now();
  const rejectedList = Array.isArray(rejected) ? rejected.map(String).slice(0, 12) : undefined;
  try {
    const out = await getReplies({
      transcript,
      history,
      patientProfile,
      fatigue,
      speaker,
      local: local === true,
      rejected: rejectedList,
      category: CATEGORIES.includes(category) ? (category as Category) : undefined,
      earlier: typeof earlier === "string" ? earlier : undefined,
      now: typeof now === "string" ? now : undefined,
    });
    res.json({ ...out, urgent: URGENT, spellOption: SPELL_OPTION, ms: Date.now() - t0 });
  } catch (err) {
    console.error("replies failed:", err);
    res.json({
      ...fallbackReplies(transcript, rejectedList), // fixed replies for the kind of question, none already rejected
      urgent: URGENT,
      spellOption: SPELL_OPTION,
      ms: Date.now() - t0,
    });
  }
});

// "I want to say something": one category's phrases in order for right now. Always responds: on any
// model failure, the candidates as given (past requests first, then the common list).
app.post("/starters", async (req, res) => {
  const { category, candidates, history, patientProfile, pastRequests, now, earlier } = req.body ?? {};
  if (!["need", "say"].includes(category) || !Array.isArray(candidates) || !candidates.length) {
    res.status(400).json({ error: "category and candidates required" });
    return;
  }
  const list = candidates.map(String).slice(0, 30);
  const past: PastRequest[] = Array.isArray(pastRequests)
    ? pastRequests
        .filter((p) => typeof p?.text === "string" && p.text.trim())
        .slice(0, 12)
        .map((p) => ({ text: p.text, n: Number(p.n) || 1, ...(Number.isFinite(p.agoMin) ? { agoMin: p.agoMin } : {}) }))
    : [];
  const t0 = Date.now();
  try {
    const out = await getStarters({
      category,
      candidates: list,
      history: Array.isArray(history) ? history : undefined,
      patientProfile,
      pastRequests: past,
      now: typeof now === "string" ? now : undefined,
      earlier: typeof earlier === "string" ? earlier : undefined,
    });
    res.json({ ...out, ms: Date.now() - t0 });
  } catch (err) {
    console.error("starters failed:", err);
    res.json({ starters: list, source: "fallback", ms: Date.now() - t0 });
  }
});

// A summary of the conversation for the patient and for a caregiver. 204 in mock mode, 502 on failure:
// the app writes a plain summary itself either way.
app.post("/summary", async (req, res) => {
  const { history, patientProfile, earlier } = req.body ?? {};
  if (!Array.isArray(history) || history.length === 0) {
    res.status(400).json({ error: "history required" });
    return;
  }
  try {
    const out = await summarize({ history, patientProfile, earlier: typeof earlier === "string" ? earlier : undefined });
    if (out) res.json(out);
    else res.status(204).end();
  } catch (err) {
    console.error("summary failed:", err);
    res.status(502).json({ error: "summary failed" });
  }
});

// Long-term memory: the oldest turns folded into the condensed notes. 204 in mock mode (the app writes
// a plain digest), 502 on failure (the app keeps the turns and tries again later).
app.post("/condense", async (req, res) => {
  const { earlier, turns, patientProfile } = req.body ?? {};
  if (!Array.isArray(turns) || turns.length === 0) {
    res.status(400).json({ error: "turns required" });
    return;
  }
  try {
    const text = await condense({ earlier: typeof earlier === "string" ? earlier : undefined, turns: turns.slice(0, 60), patientProfile });
    if (text === null) res.status(204).end();
    else res.json({ text });
  } catch (err) {
    console.error("condense failed:", err);
    res.status(502).json({ error: "condense failed" });
  }
});

// Testing only: load the small on-laptop model now (the app calls this when the switch is turned on).
app.post("/local-warm", (_req, res) => {
  warmLocal();
  res.status(204).end();
});

app.post("/complete", async (req, res) => {
  const { prefix, sentenceSoFar, context, local } = req.body ?? {};
  if (typeof prefix !== "string" || !prefix) {
    res.status(400).json({ error: "prefix required" });
    return;
  }
  try {
    res.json({ words: await completeWord({ prefix, sentenceSoFar, context, local: local === true }) });
  } catch (err) {
    console.error("complete failed:", err);
    res.json({ words: [] });
  }
});

// Browser streams the nurse mic straight to Cartesia Ink-2 with this token. 204 = use Web Speech instead.
app.get("/stt-token", async (_req, res) => {
  if (mockVoice()) {
    res.status(204).end();
    return;
  }
  try {
    res.json({ token: await sttToken() });
  } catch (err) {
    console.error("stt token failed:", err);
    res.status(204).end();
  }
});

// 200 audio/wav, or 204 when in mock mode (client falls back to speechSynthesis).
app.post("/speak", async (req, res) => {
  const { text } = req.body ?? {};
  if (typeof text !== "string" || !text.trim() || text.length > 500) {
    res.status(400).json({ error: "text required (<=500 chars)" });
    return;
  }
  if (mockVoice()) {
    res.status(204).end();
    return;
  }
  try {
    const wav = await synthesize(text);
    res.type("audio/wav").send(wav);
  } catch (err) {
    console.error("speak failed:", err);
    res.status(502).json({ error: "tts failed" });
  }
});

const port = Number(process.env.PORT ?? 8790);
app.listen(port, () => {
  console.log(`conversation server on http://localhost:${port}`);
  console.log(`  replies: ${process.env.ANTHROPIC_API_KEY ? "claude" : "MOCK (no ANTHROPIC_API_KEY)"}`);
  console.log(`  voice:   ${mockVoice() ? "MOCK (browser speechSynthesis)" : usingClone() ? "cartesia clone" : "cartesia default voice (set CARTESIA_VOICE_ID)"}`);
  if (!mockVoice()) void warm([...URGENT, ...CONSENT_REPLIES]);
});
