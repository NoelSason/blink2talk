# Product context (owner: Noel)

Updated: 2026-10-24 17:15 PDT

## Now
- Working on: who said each line (voice model + Claude names) and conversation summaries for the patient (Listening) and the care panel.
- Next: try speaker recognition with real voices in the room (threshold set on synthetic voices); team call on Spell it and urgent alerts, now on the CLAUDE.md Cut list.
- Blocked on: Presage vitals feed for the care panel tiles (Marco).

## Build-order status
- Step 1 (main loop): runs end to end. Samarth's Ink-2 streaming mic, Claude replies, Julian's quadrant tracker, Sonic cloned voice. `app/test/e2e.js` (29 checks) and `speakers.test.mjs` (3) pass.
- Step 2 (mocks): no env flags yet. Without a server the app falls back to sample replies and the system voice; the demo panel (`D`) shows which sources are live.
- Step 3 (nurse window): care drawer in the same window (alerts, summary, conversation with who said each line, notes, settings). Vitals tiles say "Not connected yet".
- Step 4 ("none of these"): differs from CLAUDE.md (see Deviations).
- Step 5: `app/README.md` and `docs/slides-outline.md` exist. Video, Devpost, and consent note aren't in the repo.
- Step 6 (fatigue): built early. The tracker's fatigue event switches tired mode (see Deviations).

## Interfaces as built
Input: the renderer imports `../vision` (`npm run eyes` bundles it) in its quadrant layout with default config. No IPC. Adapter `app/renderer/eyes.js` checks every handler at startup.

| Vision output | App does |
| --- | --- |
| `out.quadrant.focus`: `topLeft`\|`topRight`\|`bottomLeft`\|`bottomRight`\|null, after 300 ms | Highlights that box; null (the middle band) highlights nothing |
| `out.blink { engaged, closed, progress }` | Fill ring |
| `quadrantSelect { quadrant }`: box at hold start, hold ≥ 800 ms, fires on reopen, refractory 1.2 s | Selects the box |
| `blink { durationMs }` | Two < 700 ms within 1 s: back one page or undo |
| `rest` / `restEnd` (closed ≥ 3 s; that hold can't select) | "Resting" eye status |
| `faceLost` / `faceFound` | "Can't see you"; input ignored |
| `fatigue { level }` | `elevated` turns on tired mode |
| `calibrated` | Listening |

Conversation: `main.js` relays to `localhost:8790` over `ipcMain.handle('conversation')` (15 s timeout) and starts the server if it's down.

| Route | App use |
| --- | --- |
| `GET /config` | `urgent[]`, mock flags for the demo panel |
| `POST /replies { transcript, history, patientProfile, fatigue, speaker }` → `{ replies: string[], urgent, addressed, source, speaker }` | `patientProfile` = name, nurse's notes, most-picked phrases. First 3 replies shown. `addressed: false` → "Reply anyway". `source: "consent-rule"` → confirm screen on Yes/No. `speaker` in = `{ voice, label, isNew }`; out = `{ label, role }` names the caption and every line of that voice |
| `/replies`, `/complete` with `local: true`; `POST /local-warm`; `/config` → `localModel` | Testing-only care panel switch (off by default, saved locally): replies from the on-laptop model; greyed out without it |
| `POST /summary { history, patientProfile }` → `{ forPatient, forCaregiver[] }` (204 mock, 502 error) | 2 s after the conversation changes. `forPatient` = "So far" on Listening; `forCaregiver` = care panel Summary. Otherwise the last lines as said |
| `POST /speak { text }` → WAV, or 204 | Fetched for every reply as it shows; played in the renderer. 204 → system voice |
| `GET /stt-token` → `{ token }` | Renderer streams the mic to Cartesia `stt/turns/websocket` (Ink-2). `turn.update` = live caption, `turn.end` = question. Silence sent while speaking + 800 ms. `M` toggles |
| `POST /complete { prefix, sentenceSoFar, context }` → `{ words }` | Spell it suggestions |

Speaker recognition: renderer → `ipcMain.handle('speaker', pcm)` (16 kHz pcm_s16le of one mic turn, silence trimmed) → `{ voice: "voice-N", similarity, isNew }` or null (`app/speakers.js`).

Also accepted from any tracker: `window.blinkvoice.{select, gazeLeft, gazeRight, setFatigue}` and `patient-input` events. Keyboard stand-ins: arrows, held Space, Space Space.

## Deviations from CLAUDE.md
| Date | CLAUDE.md says | We did | Why | Affects | CLAUDE.md updated? |
| --- | --- | --- | --- | --- | --- |
| 2026-10-24 | Free text cut; first "none" re-asks Claude with `rejected`; second shows 4 categories | "None of these" opens a page with the 3 urgent phrases + Spell it (4-box speller: E/T/A/O in 2 picks, the rest in 3, Claude word suggestions). No re-ask | Noel asked for an eye-reachable speller; the urgent phrases need a place in a 4-box grid | Conversation (`/complete`; `rejected` unused) | No. Team to decide; the 4-category flow would replace this page. |
| 2026-10-24 | Push-to-talk | Always-on mic with Ink-2 turn detection; muted while the patient's voice plays; room talk waits behind "Reply anyway" | Samarth's streaming mic in `patient.html` works this way | Conversation | No. Samarth's design; worth a CLAUDE.md line. |
| 2026-10-24 | Cut: local LLM | Testing-only care panel switch "Fast replies on this laptop (testing only)": Qwen3-4B-Instruct via node-llama-cpp in the conversation server; off by default, greyed out until `npm run local-model`; Claude if it fails | Noel asked for it for testing only | Conversation (`local` flag, optional dependency) | No. Team: keep as a testing switch or remove before judging. |
| 2026-10-24 | `MOCK_STT` / `MOCK_LLM` / `MOCK_TTS` env flags and a mock badge per subsystem | Automatic fallbacks plus a "Sources" list in the demo panel | Fallbacks keep the demo running if a service drops mid-demo | Nobody | No. |
| 2026-10-24 | Distress alerts cut | The patient picking "I'm in pain" / "I can't breathe" / "Call the nurse" badges the care button, chimes, and sends a desktop notification | It's the patient asking, not a distress detector | Nobody | No. Needs a team OK (see Open questions). |
| 2026-10-24 | `gaze` / `confirm` / `rest` / `fatigue` over `ipcRenderer` | Renderer reads the vision pipeline's own events (table above) | Tracker and screen share one renderer; IPC adds a hop for nothing | Input | No. Julian's rows to restate. |
| 2026-10-24 | `transcript` / `options` / `speak` as IPC; `{ text, intent }`, exactly 3, `highStakes` | HTTP via `main.js`; plain strings; high stakes = `source: "consent-rule"`; STT runs in the renderer on a server-issued token | Matches Samarth's server; the API key stays in the server | Conversation | No. Samarth's rows to restate. |
| 2026-10-24 | Dwell ≥ 700 ms highlights a corner | Highlight after 300 ms (vision quadrant default) | Not tuned yet | Input | No. See Open questions. |
| 2026-10-24 | Closure ≥ 3 s toggles `PAUSED` | Closure ≥ 3 s cancels that hold and shows "Resting"; no paused state | Vision emits rest per closure, not as a toggle | Input | No. |
| 2026-10-24 | Fatigue is step 6, after 1–5: one dwell multiplier | Tired mode: 2 replies, larger text, fatigue sent to Claude. On from vision `elevated` or `T` | Built before CLAUDE.md, for the demo | Input, Conversation | No. |

## Decisions (newest first)
- 2026-10-24: Nurse mic turns: Ink-2 `end_timeout_ms: 1500`, `end_threshold: 0.3` (Samarth's settings); replies start on `turn.eager_end` and are reused if the final transcript matches; a mic turn starting ≤ 6 s after the last, before a pick, extends the same question (one caption, one conversation line, fresh replies). Why: Noel saw questions split in two, with replies for half a question; turn ends took up to ~5.6 s. Measured: Haiku at low effort already skips thinking (~82 output tokens, median 1.25 s), so turning thinking off gained nothing. Rejected: a longer turn timeout (slower for every question).
- 2026-10-24 (Marco): conversation server moved to port 8790. Port 8787 is taken on some Macs (the Obsidian kanban UI). Why: the app silently talked to the wrong server. Rejected: killing the other process.
- 2026-10-24 (Marco): camera double blink counts closures under 800 ms (was 700), and the spelling page's double-blink check now uses camera blinks. Dev mode shows each blink's length. Why: a deliberate blink ran past 700 ms and was ignored. Squint instruction reworded to plain words.
- 2026-10-24 (Marco): calibration shows the next dot's name and a countdown before each dot (2 s, set in dev mode). The overlay covers the window, translucent, with large text. Why: the patient couldn't read the prompt, and the dot appeared before they could look at it.
- 2026-10-24 (Marco): calibration never starts on its own. A Calibrate button (bottom left, highlighted until the first calibration) and C start it. Panels honor the hidden attribute, so the demo panel no longer opens at launch over the calibration dots. Why: a bad automatic calibration hid the dots and couldn't be fixed on screen.
- 2026-10-24 (Marco): dev mode (backtick) tunes the vision module's settings live and runs an 8-corner accuracy test. Head-pose model restored as an opt-in switch (`renderer/gaze.js`), off by default. Face loss debounced in `eyes.js` (500 ms gone, 150 ms back) because the vision module reports every dropped frame. Why: we need numbers, not guesses, to choose between head model and vision-only. Rejected: changing vision defaults without measuring.
- 2026-10-24: Who said each line: a speaker-recognition model (NVIDIA TitaNet-Large, ONNX via sherpa-onnx, main process) turns each mic turn into a voice print; same voice ≥ 0.6 cosine keeps its id; Claude names the voice inside `/replies` ("Dr. Lee", "Your daughter"). Prints live in memory for one launch. Why: Noel asked for a model, and Cartesia Ink-2 has no diarization that I could find. Synthetic test: 6 clips, 3 voices, all matched, ~50–230 ms each. Rejected: Claude guessing from text alone; a cloud diarization service.
- 2026-10-24: Summaries: `/summary` on Opus 5.5 (background, ~4 s), redone 2 s after the conversation changes. Patient version ≤ 45 words on Listening ("So far"); caregiver version as bullets in the care panel. Why: Noel asked for both. Rejected: a summary box in the grid (costs a gaze target).
- 2026-10-24 (Marco, branch `marco/vision-only-eyes`): the app no longer runs its own gaze model, practice round, re-center, sensitivity keys, or gaze log; `eyes.js` maps the vision module's output straight onto the screen. Why: one owner for calibration and box picking (CLAUDE.md: Input owns gaze); two classifiers disagreeing is harder to debug than one. Rejected: keeping `gaze.js` behind a flag. If head turns mis-pick boxes, fix it in `vision/`.
- 2026-10-24: The camera loop runs once per camera frame (`requestVideoFrameCallback`), and the window keeps running when covered (`backgroundThrottling: false`). Why: a `requestAnimationFrame` loop ran the face model ~110 times a second on a 120 Hz MacBook (`video.currentTime` advances every refresh), which lagged the page and shrank the 3-frame blink filter to ~28 ms. Measured: 33 ms between frames after, ~9 ms before. @Julian: `vision/src/cv/input.ts` has the same loop.
- 2026-10-24: Boxes sit in the screen's corners with the question in the middle band; calibration dots go to the box centers. Why: Noel had to exaggerate looks; a laptop screen spans only a few degrees of eye movement, so the targets need all of it. Rejected: the rest circle in the middle.
- 2026-10-24: Double blink walks back one page at a time, including out of Spell it and back to Listening from the urgent options. Why: Noel expected back to work there; it did nothing at the top of Spell it.
- 2026-10-24: (Superseded by Marco's change above.) Box picking came from `app/renderer/gaze.js` (eye features + head pose, refit from practice picks); removed.
- 2026-10-24: Eye calibration on every launch. Why: lighting and posture change. Rejected: reusing a saved calibration. (The practice round after it was removed in Marco's change.)
- 2026-10-24: Yes/No on a consent question is confirmed before speaking (the high-stakes second confirm): the question stays on screen above two tall boxes, Say "Yes" (left) and Go back (right); any left look means the left box. Why: CLAUDE.md allows it on high stakes only; Noel found the first version (a 2×2 with half empty) poor, and his recorded session separated left/right ~4x better than up/down. Rejected: "You chose X. Is that right?" in the 2×2.
- 2026-10-24: Replies checked client-side (≤ 10 words, ≤ 80 chars, no duplicates; else Yes / No / Please say that again). Why: the prompt alone doesn't guarantee it.
- 2026-10-24: Nurse window is a drawer in the patient window (answers Marco's question). Why: one laptop, one window; the drawer opens only from the corner button.
- 2026-10-24: Voice for every reply on screen is fetched when it shows. Why: the pick plays with no ~3 s wait. Rejected: fetch on select.
- 2026-10-24: Patient memory: care-panel notes plus phrases picked 2+ times go to Claude as `patientProfile`, stored in `localStorage` only. Why: personal suggestions. Rejected: server storage.
- 2026-10-24: Double blink is the one "back" gesture: undo a pick (also while speaking), leave a page, go up a level. Why: one gesture for every mistake. Rejected: an undo box (costs a grid cell).
- 2026-10-24: Page served from `app://`, not `file://`. Why: MediaPipe fetches its WASM and model; fetch fails on `file://`. Rejected: inlining assets.
- 2026-10-24: Server calls go through `main.js`. Why: no CORS setup in the server. Rejected: fetch from the renderer.
- 2026-10-24: Local Claude timeout 8 s (`conversation/.env`). Why: Opus took 3.4–5.5 s; Haiku is now the default.

## Open questions / needs from others
- @Marco: Presage preload from `preload.js` and `worker-src blob:` in the CSP are fine. Send `vitals` over IPC and the care panel tiles will show them.
- @team: CLAUDE.md (2026-10-25 scope cut) now lists the scanning keyboard / free text and distress alerts as Cut. The app still has Spell it and patient-picked urgent alerts. Keep (and update CLAUDE.md) or remove?
- @Samarth: I changed `conversation/` for this: `speaker` on `/replies` and a new `/summary` (see context/conversation.md). Please review.
- @Julian: evidence for a head-turn fix in `vision/`, from Noel's recorded session (16:38): calibration separated left/right well, and all 4 practice picks were right. Then Noel turned toward the top-left box (head yaw 0.045 → 0.09), and the eye-in-head features moved toward the other side (eye-look left/right −0.15, vs +0.17 for that box at calibration). The vision module's focus said top right for ~95% of a 15 s look at top left. Suggested fix: a calibration step where the patient keeps looking at the center dot while turning the head, so the classifier learns head-vs-eye compensation.
- @Julian: your `input.ts` webcam loop runs per display refresh, not per camera frame (see Decisions); the app's own loop is fixed. Focus comes after 300 ms (CLAUDE.md: 700), and the squint calibration step sets a per-patient closed threshold (Cut list: "per-patient blink aperture calibration"). Keep or change?

## Run and check
```sh
./start                          # repo root; calibration, then Listening
BLINK2TALK_WINDOWED=1 ./start    # 1440×900 window
cd app && npm test               # voice-matching unit tests + end-to-end checks, off-screen, no camera or server
```
