# CLAUDE.md — Blink-to-Speak ICU Communicator (Cal Hacks 13.0)

Read this every session. `DESIGN.md` is reference only; don't read it unless you need a spec. (Not written yet as of 2026-10-24.)
**If you change an interface, a mock, or a decision, update this file in the same commit.**
**Scope was cut on 2026-10-25 with ~12 build hours left. Do not re-add anything under "Cut".**
**Git: push verified work straight to `main`. No branches, no PRs, don't ask first.** Run `git pull --rebase` before every push.

## Context docs (read before you build)

Each owner keeps one file in `context/` (`input.md`, `conversation.md`, `patient-state.md`, `product.md`).
Start of session: read yours fully, skim everyone else's "Now" and "Deviations" sections.
Follow this file by default. If you deviate, add a row to your Deviations table in the same commit, and if
the deviation changes an interface someone else consumes, also fix the table below and append to the decisions log.
`git config core.hooksPath .githooks` once, so a push with code changes but no context update is refused.
Convention and templates: `context/README.md`. Use `/handoff` before pushing.

## What we are building

A patient who is awake, intubated, and can't use their hands communicates by eye. The nurse speaks
(push-to-talk), Claude proposes 3 short replies plus "none of these" in a 2x2 grid, the patient looks at
a corner and confirms with a squint or closure (≥ 800 ms), and the reply is spoken in the patient's cloned
voice. A care drawer shows the nurse the transcript and alerts.

Stack: Electron 28+, run unpackaged with `npm start`. MediaPipe Face Landmarker in the renderer for
gaze and blink/squint. Claude `claude-haiku-5-5` for replies.
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

## Input (one path)

- 20 s look-at-dot calibration (4 corners + center). No hands needed.
- 2x2 grid: 3 replies + "none of these" in the four corners; center = dead zone ("thinking").
- Dwell ≥ 700 ms on a corner highlights it. Exaggerated corner glances are fine and encouraged.
- Confirm = eyelids narrowed or closed ≥ 800 ms (squint counts). Hysteresis T / T+0.05. Refractory 1.2 s.
- Fill-ring countdown while confirming; opening early aborts.
- `numFaces: 1`, largest face wins. Camera on a stand, caregiver out of frame.

## "None of these" flow

1. First "none": re-ask Claude with `rejected: [...]`, demand three different intents.
2. Second "none": show four fixed categories (pain, body/comfort, people, question); one more Claude round from the chosen category.
3. After that, the nurse asks a different question.

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

Transport: `ipcRenderer`/`ipcMain` for events. All events carry `t` (ms epoch).

## State machine (patient window)

`IDLE → LISTENING (PTT held) → THINKING (Claude) → OPTIONS (2x2) → SPEAKING → IDLE`
Override: `PAUSED` (rest). High-stakes options show a second confirm before SPEAKING.

## Mock modes

`MOCK_STT` (typed text / hotkeys 1-2-3) · `MOCK_LLM` (canned replies, one `highStakes`) · `MOCK_TTS` (pre-rendered WAVs).
Env flags read once at startup. UI shows a "mock" badge per active subsystem. The camera is live or absent.

## Claude contract

Exactly 3 first-person replies ≤ 8 words, different intents. Consent / code-status / medication questions
→ only Yes / No / "I need more time" and `highStakes: true`. Never invent symptoms. JSON schema output.
"None of these" is added by the UI, never by the model.

## Known limitations (say these in README and Q&A, don't fix them now)

- Needs the patient to hold gaze; no fallback for nystagmus or a swollen eye.
- Blink/squint thresholds not validated across eye shapes; duration gate is the main protection. Tested on 4 teammates.
- No free text. No vitals: the monitor above the bed does that.

## Decisions log (append, newest first; date + who)

- 2026-10-24 — Product (Noel): conversation lines are labeled with who said them (on-device TitaNet voice prints + Claude names them in `/replies` → `speaker`), and a new `/summary` (Opus 5.5) feeds "So far" on Listening and the care panel. @Samarth: `conversation/` changed, see context/conversation.md.
- 2026-10-24 — Marco: Presage vitals cut. Redundant with ICU monitors; not worth bending the product for one sponsor track. Owner 3 becomes submission, evidence, and doc reconciliation.
- 2026-10-25 — Input: 2x2 gaze with 20 s calibration + squint confirm. Scanning/blink mode cut.
- 2026-10-25 — Scope cut to build order above; scanning keyboard, alerts, Spacetime, Figma dropped.
- 2026-10-24 — Voice vendor: Cartesia for both STT and TTS. ElevenLabs is fallback only.

## Owners

1 Input (gaze/squint) · 2 Conversation (STT, Claude, TTS) · 3 Submission + evidence (video, Devpost, README, consent note, human test numbers, CLAUDE.md reconciliation) · 4 Product (shell, state machine, mocks, demo, Devpost).

## Run

```
cp .env.example .env   # fill keys; never commit .env
npm install
npm start               # offline: MOCK_STT=1 MOCK_LLM=1 MOCK_TTS=1 npm start
```
