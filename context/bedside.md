# Bedside context (owner: Julien)

Updated: 2026-10-24 18:20 PDT

Julien also owns `vision/` → `context/input.md`. Separate file because this is a separate subsystem,
not a separate person; the merge-conflict rationale in `context/README.md` still holds.

## Relationship to Noel's local path — read this first

`conversation/src/local.ts` already runs a local model: Qwen3-4B-Instruct Q4_K_M through
node-llama-cpp on the Apple GPU, grammar-constrained JSON, measured at **0.85 s median** (034b266).
It answers "can a local model be fast enough" — yes, on the Mac — so the measurement spike this
module was planning is largely already done, and it picked the model my plan's own gate pointed at.

**That makes the two overlap on inference and not at all on content.** `local.ts` swaps where the
same generic "3 most likely replies" come from. `bedside/` changes what is asked for: classify the
nurse's turn, then fill a fixed slot structure, so a polar question generates one span instead of
three sentences and a procedure announcement generates nothing. The measured 65% token reduction
and the `Wait` / news-receipt rows are the point here, not the privacy.

Open: whether `bedside/` should drop its own runtime plan and call `local.ts`, or stay separate.
Calling it would mean one model in memory instead of two, which on a 15.5 GB laptop is not a detail.

## Now
- Working on: `bedside/`, a local-only content engine for the four boxes. Steps 1-3 of the plan:
  module skeleton, slot table, `place()` invariants, rules classifier, hand-authored idle/drill
  boards. **Runs with no model and no keys.**
- Next: the measurement spike (is Gemma 3n E4B fast enough on this hardware at all), then STT, then
  the model adapter for the generated spans.
- Blocked on: team call on the "local LLM" Cut entry below. Nothing else.

## Build-order status
This module is not in `CLAUDE.md`'s build order. Against its own plan:
- Step 1 (measurement spike): **not run.** Ollama is not installed on this machine. Every latency
  number in the plan is an estimate until it is. Hard gate: if polar P50 > 2.5 s, swap E4B for a 1B.
- Steps 2-3 (skeleton, zero inference): done. `npm test` covers the layout invariants and the
  classifier; `npm run eval` reports classification accuracy over 38 labelled nurse phrases.
- Steps 4-9 (STT, model, `memory.md`, PTT in the app, Piper TTS, backchannel): not started.
- The app does not consume this yet. `conversation/` is untouched and still the live path.

## Interfaces as built
HTTP on `localhost:8788`. The unit is a **Board**: four already-positioned boxes the app renders
verbatim. Deliberately not `/replies`-shaped — the app does no ranking and no placement.

- `GET  /health` → `{ ok, backend, model, mock:{llm,stt,tts}, urgent[] }`
- `GET  /board/idle` → Board (patient-initiated; four content boxes, **no escape**)
- `POST /board/open {openId, fatigue?, accuracy?}` → Board | 404
- `POST /turn/open {}` → `202 {turnId, prefill}` — PTT key-down; will warm the prompt prefix
- `POST /turn/close {turnId, text, fatigue?, accuracy?}` → Board (audio instead of `text` in step 4)
- `POST /turn/cancel {turnId}` → 204
- `POST /spoke {turnId}` → `{retract: Board, ttlMs}`
- `POST /event {type,...}` → 204 · `GET /metrics` → escape rate, yes:no ratio, per-turn-type
- `GET  /orientation` → `{text}`

Board: `{boardId, turnId, kind, turnType, caption, contentBoxes, slots[4], confirm, backTo?, ms, source}`.
`slots` is **reading order** (`topLeft, topRight, bottomLeft, bottomRight`), `null` = empty cell.

## Deviations from CLAUDE.md
| Date | CLAUDE.md says | We did | Why | Affects | CLAUDE.md updated? |
| --- | --- | --- | --- | --- | --- |
| 2026-10-24 | "local LLM" is under **Cut (do not build, do not suggest)** | Built `bedside/`, a local-first content server | Privacy, plus the content design below. Conflicts with a line the team agreed on. Precedent: Noel's `local.ts` is the same deviation, kept as a testing-only switch and documented that way. Same framing applies here until the team says otherwise | Everyone | no — not mine to change unilaterally |
| 2026-10-24 | Push-to-talk | Planned PTT on `ControlRight` | This is a *return* to the contract; the always-on Ink-2 mic is Samarth's logged deviation. `Space` is taken by the patient's long blink | Conversation, Product | no, already the contract |
| 2026-10-24 | `options.replies` = 3 × `{text, intent}` | Board with 4 positioned slots carrying `role` | The app should not be ranking or placing. `intent` is subsumed by `role`, which is richer and server-assigned | Product | no. New module, new contract; `conversation/` unchanged |
| 2026-10-24 | High-stakes → Yes / No / "I need more time" | Consent → Yes / No / "Explain more", `confirm: true` | Matches `conversation/src/safety.ts` and `references/quadrant-content.md`. Two of three sources say "Explain more" | Product | no. **Worth settling: three places disagree** |
| 2026-10-24 | No such thing | Idle/drill boards carry **no escape box** | Their content is hand-authored, so there is nothing to escape from, and the 4th cell is worth more as content | Product | no |
| 2026-10-24 | No such thing | `bedside/src/safety.ts` duplicates `conversation/src/safety.ts` | Independence: this module must work with `conversation/` deleted. Cost is drift; noted in both files | Conversation | no |

## Decisions (newest first)
- 2026-10-24: Runtime is **undecided**, pending the question above. The plan assumed Ollama; the team
  has since standardised on node-llama-cpp with Qwen3-4B. `bedside/` currently needs no runtime at
  all, so this is not yet blocking. Do not install a second runtime before settling it.
- 2026-10-24: Port 8788. `conversation/` moved to 8790 (8787 was taken by other local tools), so
  there is no clash, but neither port is the obvious default any more.
- 2026-10-24: Model emits **pipe-delimited spans, not JSON** (`P|its my back`). Why: JSON scaffolding
  is ~14 extra tokens ≈ +2 s/turn at 7 tok/s, and it blocks progressive box fill. Rejected: the
  `output_config.format.json_schema` approach `conversation/` uses — correct for Claude, wrong here.
- 2026-10-24: **Rules classify first, model is the tie-breaker.** Regex handles consent, procedure,
  wh, alternative and polar confidently; only bare declaratives go to the model. Keeps the model off
  the critical path for most turns. Rejected: model-classifies-everything.
- 2026-10-24: Four prompt cache tiers (system @boot, `memory.md` @file-change, history @key-down,
  transcript @release). Why: prefill at 50-100 tok/s dominates; only ~22 tokens may touch the
  critical path. Rejected: one prefill at key-down.
- 2026-10-24: Escape rate is the loss function, collected in-module (`/metrics`). Optimise boxes for
  coverage, not top-3 likelihood. Rejected: shipping without instrumentation.
- 2026-10-24: Text-only GGUF (4.54 GB) over Ollama's `gemma3n:e4b` (9.8 GB, multimodal). Why: the
  registry package does not fit in 15.5 GB alongside Windows, Electron and WSL.
- 2026-10-24: Piper for TTS. Why: the only local TTS fast enough here. **Cost: the cloned patient
  voice does not survive going fully local.** Rejected: XTTS-v2 (~2 GB more, seconds per utterance).
- 2026-10-24: Separate `bedside` IPC channel in `app/main.js`, not an extended `conversation`
  allow-list. Why: two backends, two channels, so a bug in one cannot route to the other.
- 2026-10-24: `memory.md` is reached over HTTP, so the app needs **no file IPC** — `app/main.js`
  keeps its single fs write path (`gaze-log`).

## Open questions / needs from others
- @everyone: the "local LLM" Cut entry. I am building against it. Veto now if you're going to.
- @Noel: `bedside` IPC channel + `BLINK2TALK_PROVIDER` flag in `app/`, so both servers stay demoable.
  I'll write it unless you'd rather.
- @Samarth: consent third option — "Explain more" or "I need more time"? Three sources disagree.
- @everyone: `references/quadrant-content.md` is untracked. It is the spec for all of this. Commit it?

## Run and check
```sh
cd bedside && npm install && cp .env.example .env
npm start     # http://localhost:8788 — no model, no keys needed
npm test      # layout invariants, slot table, classifier
npm run eval  # classification accuracy + how many spans we avoid generating
```
