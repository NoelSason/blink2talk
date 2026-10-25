import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { completeWord, getReplies, summarize } from "./claude.js";
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
    mockReplies: process.env.MOCK_REPLIES === "1" || !process.env.ANTHROPIC_API_KEY,
    mockVoice: mockVoice(),
    clonedVoice: usingClone(),
    localModel: localModelAvailable(), // testing only: the small on-laptop model is downloaded
  });
});

// Always responds: on any model failure, falls back to safe generic options.
app.post("/replies", async (req, res) => {
  const { transcript, history, patientProfile, fatigue, speaker, local } = req.body ?? {};
  if (typeof transcript !== "string" || !transcript.trim()) {
    res.status(400).json({ error: "transcript required" });
    return;
  }
  const t0 = Date.now();
  try {
    const out = await getReplies({ transcript, history, patientProfile, fatigue, speaker, local: local === true });
    res.json({ ...out, urgent: URGENT, spellOption: SPELL_OPTION, ms: Date.now() - t0 });
  } catch (err) {
    console.error("replies failed:", err);
    res.json({
      replies: CONSENT_REPLIES, // yes / no / explain: safe when the model is down
      source: "fallback",
      addressed: true,
      speaker: null,
      urgent: URGENT,
      spellOption: SPELL_OPTION,
      ms: Date.now() - t0,
    });
  }
});

// A summary of the conversation for the patient and for a caregiver. 204 in mock mode, 502 on failure:
// the app writes a plain summary itself either way.
app.post("/summary", async (req, res) => {
  const { history, patientProfile } = req.body ?? {};
  if (!Array.isArray(history) || history.length === 0) {
    res.status(400).json({ error: "history required" });
    return;
  }
  try {
    const out = await summarize({ history, patientProfile });
    if (out) res.json(out);
    else res.status(204).end();
  } catch (err) {
    console.error("summary failed:", err);
    res.status(502).json({ error: "summary failed" });
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
