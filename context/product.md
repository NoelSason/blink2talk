# Product context (owner: Noel)

Updated: 2026-10-24 15:26 PDT

## Now
- Working on: the full loop on one laptop (`./start`): mic → Claude → 2x2 → squint → cloned voice, with eye onboarding every launch.
- Next: decide Spell it vs the four-category "none" flow with the team; record the backup video.
- Blocked on: Presage vitals feed for the care panel tiles (Marco).

## Build-order status
- Step 1 (main loop): runs end to end. Samarth's Ink-2 streaming mic, Claude replies, Julian's quadrant tracker, Sonic cloned voice. `app/test/e2e.js` (21 checks) passes.
- Step 2 (mocks): no env flags yet. Without a server the app falls back to sample replies and the system voice; the demo panel (`D`) shows which sources are live.
- Step 3 (nurse window): care drawer in the same window (alerts, conversation, notes, settings). Vitals tiles say "Not connected yet".
- Step 4 ("none of these"): differs from CLAUDE.md (see Deviations).
- Step 5: `app/README.md` and `docs/slides-outline.md` exist. Video, Devpost, and consent note aren't in the repo.
- Step 6 (fatigue): built early. The tracker's fatigue event switches tired mode (see Deviations).

## Interfaces as built
Input: the renderer imports `../vision` (`npm run eyes` bundles it) in its quadrant layout with default config. No IPC. Adapter `app/renderer/eyes.js` checks every handler at startup.

| Vision output | App does |
| --- | --- |
| `out.quadrant.focus`: `topLeft`\|`topRight`\|`bottomLeft`\|`bottomRight`\|null, after 300 ms | Highlights that box; null (center) highlights nothing |
| `out.blink { engaged, closed, progress }` | Fill ring |
| `quadrantSelect { quadrant }`: box at hold start, hold ≥ 800 ms, fires on reopen, refractory 1.2 s | Selects the box |
| `blink { durationMs }` | Two < 400 ms within 700 ms: back or undo |
| `rest` / `restEnd` (closed ≥ 3 s; that hold can't select) | "Resting" eye status |
| `faceLost` / `faceFound` | "Can't see you"; input ignored |
| `fatigue { level }` | `elevated` turns on tired mode |
| `calibrated` | 4-box practice round, then Listening |

Conversation: `main.js` relays to `localhost:8787` over `ipcMain.handle('conversation')` (15 s timeout) and starts the server if it's down.

| Route | App use |
| --- | --- |
| `GET /config` | `urgent[]`, mock flags for the demo panel |
| `POST /replies { transcript, history, patientProfile, fatigue }` → `{ replies: string[], urgent, addressed, source }` | `patientProfile` = name, nurse's notes, most-picked phrases. First 3 replies shown. `addressed: false` → "Reply anyway". `source: "consent-rule"` → "Is that right?" on Yes/No |
| `POST /speak { text }` → WAV, or 204 | Fetched for every reply as it shows; played in the renderer. 204 → system voice |
| `GET /stt-token` → `{ token }` | Renderer streams the mic to Cartesia `stt/turns/websocket` (Ink-2). `turn.update` = live caption, `turn.end` = question. Silence sent while speaking + 800 ms. `M` toggles |
| `POST /complete { prefix, sentenceSoFar, context }` → `{ words }` | Spell it suggestions |

Also accepted from any tracker: `window.blinkvoice.{select, gazeLeft, gazeRight, setFatigue}` and `patient-input` events. Keyboard stand-ins: arrows, held Space, Space Space.

## Deviations from CLAUDE.md
| Date | CLAUDE.md says | We did | Why | Affects | CLAUDE.md updated? |
| --- | --- | --- | --- | --- | --- |
| 2026-10-24 | Free text cut; first "none" re-asks Claude with `rejected`; second shows 4 categories | "None of these" opens a page with the 3 urgent phrases + Spell it (4-box speller: E/T/A/O in 2 picks, the rest in 3, Claude word suggestions). No re-ask | Noel asked for an eye-reachable speller; the urgent phrases need a place in a 4-box grid | Conversation (`/complete`; `rejected` unused) | No. Team to decide; the 4-category flow would replace this page. |
| 2026-10-24 | Push-to-talk | Always-on mic with Ink-2 turn detection; muted while the patient's voice plays; room talk waits behind "Reply anyway" | Samarth's streaming mic in `patient.html` works this way | Conversation | No. Samarth's design; worth a CLAUDE.md line. |
| 2026-10-24 | `MOCK_STT` / `MOCK_LLM` / `MOCK_TTS` env flags and a mock badge per subsystem | Automatic fallbacks plus a "Sources" list in the demo panel | Fallbacks keep the demo running if a service drops mid-demo | Nobody | No. |
| 2026-10-24 | Distress alerts cut | The patient picking "I'm in pain" / "I can't breathe" / "Call the nurse" badges the care button, chimes, and sends a desktop notification | It's the patient asking, not a distress detector | Nobody | No. Needs a team OK (see Open questions). |
| 2026-10-24 | `gaze` / `confirm` / `rest` / `fatigue` over `ipcRenderer` | Renderer reads the vision pipeline's own events (table above) | Tracker and screen share one renderer; IPC adds a hop for nothing | Input | No. Julian's rows to restate. |
| 2026-10-24 | `transcript` / `options` / `speak` as IPC; `{ text, intent }`, exactly 3, `highStakes` | HTTP via `main.js`; plain strings; high stakes = `source: "consent-rule"`; STT runs in the renderer on a server-issued token | Matches Samarth's server; the API key stays in the server | Conversation | No. Samarth's rows to restate. |
| 2026-10-24 | Dwell ≥ 700 ms highlights a corner | Highlight after 300 ms (vision quadrant default) | Not tuned yet | Input | No. See Open questions. |
| 2026-10-24 | Closure ≥ 3 s toggles `PAUSED` | Closure ≥ 3 s cancels that hold and shows "Resting"; no paused state | Vision emits rest per closure, not as a toggle | Input | No. |
| 2026-10-24 | Fatigue is step 6, after 1–5: one dwell multiplier | Tired mode: 2 replies, larger text, fatigue sent to Claude. On from vision `elevated` or `T` | Built before CLAUDE.md, for the demo | Input, Conversation | No. |

## Decisions (newest first)
- 2026-10-24: Eye onboarding on every launch: calibration, then 4 practice picks (one per corner, random order); the hit count shows in the demo panel. Why: lighting and posture change; gives measured accuracy. Rejected: reusing a saved calibration.
- 2026-10-24: Yes/No on a consent question asks "Is that right?" before speaking (the high-stakes second confirm). Why: CLAUDE.md allows it on high stakes only.
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
- @team: keep Spell it, or switch "none" to the 4-category flow? And are patient-picked urgent alerts OK under the "distress alerts" cut? Both are on the Cut list.
- @Julian: the app uses the vision defaults. Focus comes after 300 ms (CLAUDE.md: 700), and the squint calibration step sets a per-patient closed threshold (Cut list: "per-patient blink aperture calibration"). Keep or change?

## Run and check
```sh
./start                          # repo root; calibration + practice, then Listening
BLINK2TALK_WINDOWED=1 ./start    # 1440×900 window
cd app && npm test               # 21 end-to-end checks, off-screen, no camera or server
```
