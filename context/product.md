# Product context (owner: Noel)

Updated: 2026-10-24 15:25 PDT

## Now
- Working on: the full loop on one laptop (`./start`): mic → Claude → 2x2 → squint → cloned voice, with eye onboarding every launch.
- Next: decide Spell it vs the four-category "none" flow with the team; record the backup video.
- Blocked on: Presage vitals feed for the care panel tiles (Marco).

## Build-order status
- Step 1 (main loop): runs end to end. Samarth's Ink-2 streaming mic, Claude replies, Julian's quadrant tracker, Sonic cloned voice. `app/test/e2e.js` (21 checks) passes.
- Step 2 (mocks): no env flags yet. Without a server the app falls back to sample replies and the system voice; the demo panel (`D`) shows which sources are live.
- Step 3 (nurse window): care drawer in the same window (alerts, conversation, notes, settings). Vitals tiles say "Not connected yet".
- Step 4 ("none of these"): differs from CLAUDE.md (see Deviations).
- Step 6 (fatigue): the tracker's fatigue event switches tired mode (2 replies, larger text).

## Interfaces as built
- Input: the renderer imports `../vision` (`npm run eyes` bundles it) in its quadrant layout, not IPC events. Consumes `out.quadrant.focus` per frame, and the `quadrantSelect` (box at hold start; null = center), `blink`, `rest`/`restEnd`, `faceLost`/`faceFound`, `fatigue`, `calibrated` events. Adapter: `app/renderer/eyes.js`, which checks every handler at startup.
- Conversation: `main.js` relays `GET /config`, `GET /stt-token`, `POST /replies`, `POST /complete`, `POST /speak` over IPC. `/replies` gets `patientProfile` (name, nurse's notes, most-picked phrases) and uses `addressed` and `source === 'consent-rule'`. The mic streams from the renderer to Ink-2 with the token.
- Speak: `POST /speak {text}` → WAV, generated while the patient chooses; the system voice when it returns 204.

## Deviations from CLAUDE.md
| Date | CLAUDE.md says | We did | Why | Affects | CLAUDE.md updated? |
| --- | --- | --- | --- | --- | --- |
| 2026-10-24 | Free text cut; second "none" shows 4 categories, one more Claude round | "None of these" opens a page with the 3 urgent phrases + Spell it (4-box speller: E/T/A/O in 2 picks, the rest in 3, Claude word suggestions) | Noel asked for an eye-reachable speller; the urgent phrases need a place in a 4-box grid | Conversation (`/complete`) | No. Team to decide; the 4-category flow would replace this page. |
| 2026-10-24 | Push-to-talk | Always-on mic with Ink-2 turn detection; muted while the patient's voice plays; `M` toggles | Samarth's streaming mic in `patient.html` works this way | Conversation | No. Samarth's design; worth a CLAUDE.md line. |
| 2026-10-24 | `MOCK_STT` / `MOCK_LLM` / `MOCK_TTS` env flags and a mock badge per subsystem | Automatic fallbacks plus a "Sources" list in the demo panel | Fallbacks keep the demo running if a service drops mid-demo | Nobody | No. |
| 2026-10-24 | Distress alerts cut | The patient picking "I'm in pain" / "I can't breathe" / "Call the nurse" badges the care button, chimes, and sends a desktop notification | It's the patient asking, not a distress detector | Nobody | No. |

## Decisions (newest first)
- 2026-10-24: Eye onboarding on every launch: calibration, then 4 practice picks (one per corner, random order); the hit count shows in the demo panel. Why: lighting and posture change; gives measured accuracy. Rejected: reusing a saved calibration.
- 2026-10-24: Yes/No on a consent question asks "Is that right?" before speaking (the high-stakes second confirm). Why: CLAUDE.md allows it on high stakes only.
- 2026-10-24: Replies checked client-side (≤ 10 words, ≤ 80 chars, no duplicates; else Yes / No / Please say that again). Why: the prompt alone doesn't guarantee it.
- 2026-10-24: Nurse window is a drawer in the patient window (answers Marco's question). Why: one laptop, one window; the drawer opens only from the corner button.
- 2026-10-24: Local Claude timeout 8 s (`conversation/.env`). Why: Opus took 3.4–5.5 s; Haiku is now the default.

## Open questions / needs from others
- @Marco: Presage preload from `preload.js` and `worker-src blob:` in the CSP are fine. Send `vitals` over IPC and the care panel tiles will show them.
- @team: keep Spell it, or switch "none" to the 4-category flow?

## Run and check
```sh
./start                      # repo root; calibration + practice, then Listening
cd app && npm test           # 21 end-to-end checks, off-screen, no camera or server
```
