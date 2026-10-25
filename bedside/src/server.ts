// The bedside content server. Everything on this machine; nothing leaves it.
//
// Phase 1 is deliberately model-free: rules classify the nurse's turn, the slot table fills the
// boxes, and the whole product works offline with no model downloaded at all. The model only ever
// fills in the handful of marked spans, so when it is slow, wrong, or absent, the board is still
// correct — just more generic.

import express from "express";
import { randomUUID } from "node:crypto";
import { classifyByRules } from "./classify-rules.js";
import { drillBoard, idleBoard, orientationAnswer, respondingBoard, type Orientation } from "./boards.js";
import { URGENT } from "./safety.js";
import type { Accuracy, Board, FatigueLevel } from "./types.js";

const PORT = Number(process.env.PORT ?? 8788);
const mockLlm = () => process.env.MOCK_LLM !== "0"; // phase 1: no model wired in yet

// Until memory.md lands (step 6) this is a stub so the orientation box has something to say.
const ORIENTATION: Orientation = {
  where: process.env.BEDSIDE_WHERE,
  what: process.env.BEDSIDE_WHAT,
  next: process.env.BEDSIDE_NEXT,
};

const app = express();
app.use(express.json({ limit: "1mb" }));

interface Turn {
  turnId: string;
  openedAt: number;
  fatigue?: FatigueLevel;
  accuracy?: Accuracy;
}
const turns = new Map<string, Turn>();

const placeOpts = (body: { fatigue?: FatigueLevel; accuracy?: Accuracy }) => ({
  fatigue: body.fatigue,
  accuracy: body.accuracy,
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    backend: mockLlm() ? "none" : (process.env.LLM_BACKEND ?? "ollama"),
    model: mockLlm() ? null : (process.env.LLM_MODEL ?? "gemma3n:e4b"),
    mock: { llm: mockLlm(), stt: true, tts: true },
    urgent: URGENT,
  });
});

app.get("/board/idle", (req, res) => {
  res.json(idleBoard(placeOpts(req.query as never)));
});

app.post("/board/open", (req, res) => {
  const { openId } = req.body ?? {};
  if (typeof openId !== "string") {
    res.status(400).json({ error: "openId required" });
    return;
  }
  const b = drillBoard(openId, new Date(), ORIENTATION, placeOpts(req.body));
  if (!b) {
    res.status(404).json({ error: `no board ${openId}` });
    return;
  }
  res.json(b);
});

// Push-to-talk key-down. Returns immediately: the point is to start warming the model's prompt
// prefix while the nurse is still talking, which is otherwise dead time.
app.post("/turn/open", (_req, res) => {
  const turnId = `t_${randomUUID().slice(0, 8)}`;
  turns.set(turnId, { turnId, openedAt: Date.now() });
  // TODO(step 7): kick off the tier-C prefill here, detached.
  res.status(202).json({ turnId, prefill: mockLlm() ? "skipped" : "started" });
});

app.post("/turn/cancel", (req, res) => {
  turns.delete(req.body?.turnId);
  res.status(204).end();
});

// Push-to-talk key-up. Always answers with a board: a model failure degrades to templates, never to
// an empty screen.
app.post("/turn/close", (req, res) => {
  const t0 = Date.now();
  const { turnId = `t_${randomUUID().slice(0, 8)}`, text } = req.body ?? {};
  turns.delete(turnId);

  if (typeof text !== "string" || !text.trim()) {
    res.status(400).json({ error: "text required (audio arrives in step 4)" });
    return;
  }

  const rule = classifyByRules(text);
  // TODO(step 5): when !rule.confident, ask the model for the type; then fill the generated spans.
  const board = respondingBoard({
    turnId,
    turnType: rule.type,
    transcript: text.trim(),
    ms: { classify: 0, total: Date.now() - t0 },
    source: mockLlm() ? "rules+templates" : "rules",
    opts: placeOpts(req.body),
  });
  res.json({ ...board, why: rule.why, confident: rule.confident } satisfies Board & Record<string, unknown>);
});

// "That's not what I meant." Retraction after the wrong sentence has been spoken in the patient's
// own voice is a speech act, not navigation, so it gets a box rather than the double blink.
app.post("/spoke", (req, res) => {
  const { turnId = null } = req.body ?? {};
  res.json({
    retract: {
      ...idleBoard(),
      kind: "retract" as const,
      turnId,
      caption: { speaker: "system" as const, text: "Just said it" },
      // bottomLeft, NOT topLeft: idle's topLeft is "I can't breathe", and training a conflicting
      // habit on the most dangerous cell for a 10 s window is worse than a weak-row placement.
      slots: [null, null, {
        position: "bottomLeft" as const,
        rank: 1,
        role: "retract" as const,
        label: "That's not what I meant",
        say: "That's not what I meant",
        act: "retract" as const,
        source: "fixed" as const,
      }, null],
      contentBoxes: 1,
    },
    ttlMs: 10_000,
  });
});

app.get("/orientation", (_req, res) => {
  res.json({ text: orientationAnswer(new Date(), ORIENTATION) });
});

// Escape rate is the loss function for this whole module, so it is collected here rather than
// bolted on later. Optimise the content boxes for coverage — P(at least one fits) — not for top-3
// likelihood, which clusters ("Yes" / "Yes, a lot" / "Yes please").
interface Metric { t: number; type: string; [k: string]: unknown }
const events: Metric[] = [];
app.post("/event", (req, res) => {
  events.push({ t: Date.now(), ...req.body });
  if (events.length > 5000) events.splice(0, events.length - 5000);
  res.status(204).end();
});

app.get("/metrics", (_req, res) => {
  const shown = events.filter((e) => e.type === "board");
  const picked = events.filter((e) => e.type === "select");
  const escapes = picked.filter((e) => e.role === "escape").length;
  const yes = picked.filter((e) => e.role === "affirm").length;
  const no = picked.filter((e) => e.role === "refuse").length;
  res.json({
    boards: shown.length,
    selections: picked.length,
    escapeRate: picked.length ? escapes / picked.length : null,
    yesNoRatio: no ? yes / no : null,
    byTurnType: Object.fromEntries(
      [...new Set(shown.map((e) => String(e.turnType)))].map((k) => {
        const p = picked.filter((e) => e.turnType === k);
        return [k, { selections: p.length, escapeRate: p.length ? p.filter((e) => e.role === "escape").length / p.length : null }];
      }),
    ),
  });
});

app.listen(PORT, () => {
  console.log(`bedside server on http://localhost:${PORT}`);
  console.log(`  replies: ${mockLlm() ? "RULES + TEMPLATES (no model)" : process.env.LLM_MODEL ?? "gemma3n:e4b"}`);
});
