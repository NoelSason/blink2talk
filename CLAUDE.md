# CLAUDE.md — Blink-to-Speak ICU Communicator (Cal Hacks 13.0)

Read this every session. `DESIGN.md` is reference only; don't read it unless you need a spec. (Not written yet as of 2026-10-24.)
**If you change an interface, a mock, or a decision, update this file in the same commit.**
**Scope was cut on 2026-10-25 with ~12 build hours left. Do not re-add anything under "Cut".**
**Git: commit verified work, then ask before every push.** Once the user says yes, push straight to `main` (no branches, no PRs). Run `git pull --rebase` before every push.

## Context docs (read before you build)

Each owner keeps one file in `context/` (`input.md`, `conversation.md`, `patient-state.md`, `product.md`).
Start of session: read yours fully, skim everyone else's "Now" and "Deviations" sections.
Follow this file by default. If you deviate, add a row to your Deviations table in the same commit, and if
the deviation changes an interface someone else consumes, also fix the table below and append to the decisions log.
`git config core.hooksPath .githooks` once, so a push with code changes but no context update is refused.
Convention and templates: `context/README.md`. Use `/handoff` before pushing.
Agent relay (`relay/README.md`): once set up, call `claim_work` before editing and `release_work` after. If an edit is blocked, stop and tell your human whose agent has the file.

## What we are building

A patient who is awake, intubated, and can't use their hands communicates by eye. The nurse speaks
(push-to-talk), Claude proposes 3 short replies plus "none of these" in a 2x2 grid, the patient looks at
a corner and confirms with a squint or closure (≥ 800 ms), and the reply is spoken in the patient's cloned
voice. A care drawer shows the nurse the transcript and alerts.

Stack: Electron 28+, run unpackaged with `npm start`. MediaPipe Face Landmarker in the renderer for
gaze and blink/squint. Claude `claude-opus-5-5` (fast mode, low effort) for replies.
Cartesia Ink (STT) + Sonic-3.6 (TTS, cloned voice). API keys live in the main process only.

## Build order (do these in sequence; nothing out of order)

1. Main loop end to end on one laptop: PTT → STT → Claude → 2x2 → squint → spoken. Nothing else until this runs.
2. Mocks for STT, Claude, TTS (not camera).
3. Nurse view: transcript + alerts. Static layout. No vitals.
4. "None of these" flow (see below).
5. Backup video, README, Devpost, consent note.
6. Only if 1–5 are done: fatigue slows the dwell timer (one multiplier).

## Cut (do not build, do not suggest)

- Scanning keyboard / free text. Say "we don't do free text yet."
- No-calibration fallback mode.
- Per-patient blink aperture calibration (duration gate does the work).
- Distress alerts, `uiHint`, two-step confirm except on the high-stakes screen.
- Spacetime, Figma pass, iOS, packaging/asar, local LLM.
- Vertical-only gaze, Morse code, any "FDA-cleared" wording.
- Presage / camera vitals (pulse, breathing). ICU patients are already on monitors; a vented patient's breathing rate is the ventilator's. Cut 2026-10-24.
- Head-movement input (nod or turn to pick) and phone face tracking (iPhone TrueDepth/LiDAR). Most of our patients can't move their head reliably (tube, sedation, neck collars, ALS neck weakness, locked-in). Eyes stay the only input. Cut 2026-10-24.

## Input (one path)

- ~23 s look-at-dot calibration (4 corners + center, 3 s per dot). No hands needed.
- 2x2 grid: 3 replies + "none of these" in the four corners; center = dead zone ("thinking").
- Dwell ≥ 700 ms on a corner highlights it. Exaggerated corner glances are fine and encouraged.
- Confirm = eyelids narrowed or closed ≥ 800 ms (squint counts). Hysteresis T / T+0.05. Refractory 1.2 s.
- Fill-ring countdown while confirming; opening early aborts.
- `numFaces: 1`, largest face wins. Camera on a stand, caregiver out of frame.

## "None of these" flow

1. First "none": re-ask Claude with `rejected: [...]` (every reply shown for this question). Three new replies on the same question, each adding a reason or detail; if an answer and its opposite were rejected (yes and no), at least one reply for each side.
2. Second "none": the same again, with both sets rejected.
3. Third "none": the urgent phrases + Spell it (Spell it is on the Cut list; team call pending).

High-stakes question: the re-asks are fixed clarifying replies (`conversation/src/safety.ts`: "Please explain it again", "What are the risks?", …), never a reworded yes or no. Claude down: fixed replies for the kind of question, never one already rejected. `patient.html` (test page) keeps a topic picker at step 2.

## Interfaces — emit exactly these

| Event | From → To | Payload |
| --- | --- | --- |
| `gaze` | Input → Product | `{ corner: "tl"\|"tr"\|"bl"\|"br"\|"center", t }` (after dwell) |
| `confirm` | Input → Product | `{ t }` (squint/closure ≥ 800 ms, after refractory) |
| `rest` | Input → Product | `{ t }` (closure ≥ 3 s toggles PAUSED) |
| `fatigue` | Input → Product | `{ score: 0..1, blinkRate, baseline }` (step 6 only) |
| `transcript` | Conversation → Product | `{ text, final: bool }` |
| `options` | Conversation → Product | `{ replies: [{ text, intent }], highStakes: bool }` (exactly 3; UI adds "none") |
| `speak` | Product → Conversation | `{ text }` (resolves when playback ends) |
| `starters` | Conversation → Product | `{ starters: string[] }` = the given `candidates` reordered for now, from `{ category: "need"\|"say", candidates, history, patientProfile, pastRequests, now }` (never new text) |

Transport: `ipcRenderer`/`ipcMain` for events. All events carry `t` (ms epoch).

## State machine (patient window)

`IDLE → LISTENING (PTT held) → THINKING (Claude) → OPTIONS (2x2) → SPEAKING → IDLE`
Override: `PAUSED` (rest). High-stakes options show a second confirm before SPEAKING.

## Mock modes

`MOCK_STT` (typed text / hotkeys 1-2-3) · `MOCK_LLM` (canned replies, one `highStakes`) · `MOCK_TTS` (pre-rendered WAVs).
Env flags read once at startup. UI shows a "mock" badge per active subsystem. The camera is live or absent.

## Claude contract

Exactly 3 first-person replies ≤ 8 words, different intents. Consent / code-status / medication questions
→ only Yes / No / "I need more time" and `highStakes: true`; after "None of these", the fixed clarifying replies. Never invent symptoms. JSON schema output.
"None of these" is added by the UI, never by the model.

## Known limitations (say these in README and Q&A, don't fix them now)

- Needs the patient to hold gaze; no fallback for nystagmus or a swollen eye.
- Blink/squint thresholds not validated across eye shapes; duration gate is the main protection. Tested only by the team so far, not with patients.
- No free text. No vitals: the monitor above the bed does that.

## Decisions log (append, newest first; date + who)

- 2026-10-25 — Noel: nurse mic is push-to-talk on M (hold, let go to send), as designed above; "Always listening" in the care panel switches back to the always-on mic, where M mutes. Hold S skips the eye calibration. Who-questions now offer people (named ones first, then "My partner", "My children"…), never a guessed gender. Details in context/product.md and context/conversation.md.

- 2026-10-25 — Marco: default patient layout back to the Kahoot 2x2 (question on top, 2x2 below). Four columns didn't work in testing. Row of 4 stays a dev-mode switch.
- 2026-10-25 — Noel: agent relay at agents.blink2talk2.us (`relay/`, `.claude/hooks/relay.mjs`). Agents claim files before editing; a hook blocks an edit to another teammate's claimed file and tells both humans, who resolve it. Team tooling, not product. Setup in `relay/README.md`.
- 2026-10-25 — Noel: "None of these" flow rewritten above to match the app (two re-asks on the same question, then urgent + Spell it); the topic picker stays in `patient.html`. A stress test of the re-asks found: high-stakes re-asks repeated Yes / No / I need more time, a failed Claude call repeated rejected replies (and answered "Where does it hurt?" with Yes / No), and yes/no re-asks gave only one side. All fixed in `conversation/` (context/conversation.md). Rejected: weighting the box the patient looked at longest, because that mostly measures how long a reply takes to read. Arrow keys now follow the row layout.
- 2026-10-25 — Product/Conversation (Julian): Claude gets the last ~100 turns verbatim with timestamps; older turns are condensed 20 at a time into long-term notes (`/condense`) kept in `patient_memory.json`. Details in context/product.md.
- 2026-10-24 — Product (Julian): patient memory (profile, conversation, picks, requests) lives in `patient_memory.json` at the repo root, git-ignored, instead of browser localStorage. One patient per computer for now. Details in context/product.md.
- 2026-10-24 — Product/Conversation (Julian): "I want to say something" opens a fixed Start screen from references/quadrant-content.md: I need something → / I want to ask or say → / Emergency ("I need help now", always alerts) / I'm in pain. Categories list past requests first, then common phrases; Claude only reorders them. "None of these" never repeats anything: categories page forward to Spell it, and rejected replies are filtered out (nothing new → urgent options). Urgent items stay fixed and never model-made. Details in context/product.md.

- 2026-10-25 — Marco: default patient layout is a row of 4 tall boxes (left-right eye movement only) instead of the 2x2. Up-down was the weak axis. 2x2 layouts remain in dev mode. Details in context/product.md.
- 2026-10-25 — Marco: Claude asks before every push (commits locally until then). Auto-pushing was annoying. Still straight to `main`, no PRs.
- 2026-10-24 — Noel: WebEyeTrack removed (code, weights, dependency, `G` switch); the vision module is the only gaze source. Replies move to `claude-opus-5-5` in fast mode with a rewritten prompt: on 37 labeled phrases, grade 3.81 → 4.51 of 5 and median 1.33 → 1.21 s (`npm run eval:replies`). The prompt was tuned on those 37, so on 34 held-out phrases it never saw: 3.76 → 4.38, rule problems 4 → 0, median 1.53 → 1.16 s. @Samarth: `conversation/` changed, see context/conversation.md.
- 2026-10-25 — Marco: patient screen is Kahoot style (question on top, 2x2 colored boxes together below). Spread layout kept as a dev-mode switch. Details and the reading-the-question risk in context/product.md.
- 2026-10-24 — Marco: head-movement input and the phone face-tracking model cut. Our target patients mostly can't move their head; eye input must work alone. The dev-mode head-pose switch only corrects eye picks for head turns and isn't an input.
- 2026-10-24 — Input/Product (Marco): box picking decides left/right and top/bottom on separate axes; calibration dots and corner marks at the box corners (±0.9); kept picks teach the classifier; WebEyeTrack available as a test gaze source in dev mode. Dwell to highlight stays 300 ms (vision default), not 700. Measured cause in context/input.md.
- 2026-10-24 — Product/Conversation (Noel): `/replies` now returns `highStakes` (Claude classifies; keyword rule only as fallback) and `about`, closer to the `options.highStakes` row above. Eye calibration auto-starts at launch again; three quick blinks offer recalibration.

- 2026-10-24 — Product (Noel): a testing-only "Fast replies on this laptop" switch in the care panel (local Qwen3-4B, off by default) despite "local LLM" on the Cut list. Not for the demo or patients; team to keep or remove. App mic now uses Samarth's Ink-2 turn settings and joins split questions.

- 2026-10-24 — Product (Noel): conversation lines are labeled with who said them (on-device TitaNet voice prints + Claude names them in `/replies` → `speaker`), and a new `/summary` (Opus 5.5) feeds "So far" on Listening and the care panel. @Samarth: `conversation/` changed, see context/conversation.md.
- 2026-10-24 — Marco: Presage vitals cut. Redundant with ICU monitors; not worth bending the product for one sponsor track. Owner 3 becomes submission, evidence, and doc reconciliation.
- 2026-10-25 — Input: 2x2 gaze with 20 s calibration + squint confirm. Scanning/blink mode cut.
- 2026-10-25 — Scope cut to build order above; scanning keyboard, alerts, Spacetime, Figma dropped.
- 2026-10-24 — Voice vendor: Cartesia for both STT and TTS. ElevenLabs is fallback only.

## Owners

1 Input (gaze/squint) · 2 Conversation (STT, Claude, TTS) · 3 Submission + evidence (video, Devpost, README, consent note, human test numbers, CLAUDE.md reconciliation) · 4 Product (shell, state machine, mocks, demo, Devpost).

## Run

```
cp conversation/.env.example conversation/.env   # fill keys; never commit .env
./start                 # installs what's missing, starts the server, opens the app full screen
# offline: set MOCK_REPLIES=1 and MOCK_VOICE=1 in conversation/.env (canned replies, system voice)
# patient memory: patient_memory.json at the repo root (git-ignored); delete it to start a new patient
```
