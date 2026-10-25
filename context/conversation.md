# Conversation context (owner: Samarth)

Updated: 2026-10-24 23:30 PDT

## Now
- Working on: Ink-2 mic latency (1.5 s turn cap, prefetch on `turn.eager_end`), tested in `patient.html`.
- Next: match CLAUDE.md contract: exactly 3 replies with `intent`, `highStakes`, `rejected` re-ask, 4-category second round. Then port the Ink-2 mic into `app/` (Noel's code, coordinate).
- Blocked on: team call on the Cut item below (`/complete` + spelling UI).

## Build-order status
- Step 1 (PTT, STT, Claude, TTS): server loop works end to end on `patient.html`. Not yet in Noel's Electron app: it has no nurse mic.
- Step 2 (mocks): `MOCK_REPLIES`, `MOCK_VOICE` exist and fall back automatically with no keys. No STT mock; typed input in the page stands in.
- Step 4 ("none of these" flow): NOT built server-side. Needs `rejected` and category round in `/replies`.

## Interfaces as built
HTTP on `localhost:8790` (Noel's `main.js` proxies it over IPC):
- `POST /replies {transcript, history?, patientProfile?, fatigue?, speaker?}` -> `{replies: string[3-4], addressed, speaker, urgent[], spellOption, source, ms}`. `speaker` in: `{voice, label?, isNew?}` (app's voice model); out: `{label, role}` or null.
- `POST /summary {history, patientProfile?}` -> `{forPatient, forCaregiver[], source}` (`SUMMARY_MODEL`, default `claude-opus-5-5`; 204 = mock, 502 = failed)
- `POST /complete {prefix, sentenceSoFar?, context?}` -> `{words[]}`
- `POST /speak {text}` -> `audio/wav` (204 = mock, client uses system voice)
- `GET /stt-token` -> `{token}` (1 h, STT-only; 204 = mock)
- STT: browser streams mic to Cartesia Ink-2 (`/stt/turns/websocket`) with that token; `turn.end` = nurse done. `patient.html` only.
- Browser hook: `window.blinkvoice.select/gazeLeft/gazeRight/setFatigue`.

## Deviations from CLAUDE.md
| Date | CLAUDE.md says | We did | Why | Affects | CLAUDE.md updated? |
| --- | --- | --- | --- | --- | --- |
| 2026-10-24 | IPC events `options`/`transcript`/`speak` | HTTP routes; Noel's `main.js` bridges to IPC | Server built standalone first | Product | no, bridge works; revisit only if it breaks |
| 2026-10-24 | `options.replies` = exactly 3 `{text, intent}` | 3-4 plain strings, no `intent` | Built before the 2x2 decision | Product | no. Fix is in Next |
| 2026-10-24 | `highStakes: bool`; high-stakes replies Yes / No / "I need more time" | Regex consent rule returns Yes / No / "Explain more", no flag | Built before contract | Product (second confirm) | no. Fix is in Next |
| 2026-10-24 | Push-to-talk | Always-on mic, Ink-2 turn detection ends the turn | Fewer presses, no hands needed on the nurse side | Product | no |
| 2026-10-24 | "None of these" added by the UI, never the model | Server returns `spellOption` string | Built before the contract | Product | no. UI should own it |
| 2026-10-24 | No such thing | Hard-coded `urgent[]` ("I'm in pain", "I can't breathe", "Call the nurse") on every screen | Never rely on a model for emergencies | Product, Input | no. Not an alert system, just fixed options. Team may veto |
| 2026-10-24 | No such thing | `addressed` flag; room talk gets "Reply anyway" | Mic hears everyone | Product | no |

## CUT ITEM STILL IN MY CODE (needs a team call, not a deviation)
`POST /complete` and the spelling mode in `patient.html` are the scanning keyboard / free text that CLAUDE.md cuts. Noel's app also still has Spell it. Proposal: stop using both in the demo, keep the code dormant, say "we don't do free text yet." Not removed yet.

## Decisions (newest first)
- 2026-10-24 (Noel, for the patient app; Samarth please review): `/replies` takes `speaker {voice, label?, isNew}` and returns `speaker {label, role}` from the same call (no added latency). New `POST /summary` → `{forPatient, forCaregiver[]}` on `SUMMARY_MODEL` (default `claude-opus-5-5`, background, 30 s). Why: Noel wants who-said-what and summaries for the patient and caregiver. Rejected: a separate labeling call (adds a round trip).
- 2026-10-24: Ink-2 turn config `end_timeout_ms: 1500`, `end_threshold: 0.3`; Claude request starts on `turn.eager_end`, discarded on `turn.resume`. Why: default waits up to 5.6 s. Rejected: Web Speech (Google servers, Chrome-only, fails in Electron/Brave).
- 2026-10-24: Mic sends silence while the patient's voice plays. Why: stop the patient being transcribed as the nurse. Rejected: pausing the mic.
- 2026-10-24: Browser gets a short-lived STT-only token, never the API key. Rejected: key in the page.
- 2026-10-24: Claude 3 s timeout, then Yes / No / Explain more. Noel raised his client timeout to 8 s; the server's 3 s still decides.
- 2026-10-24: Default model `claude-haiku-5-5`. Why: median ~1.2 s vs seconds on Opus. Rejected: Opus 5.5 default.
- 2026-10-24: Cartesia for STT + TTS + clone (CLAUDE.md log). Rejected: ElevenLabs.

## Open questions / needs from others
- @Noel: OK to add the Ink-2 mic to `app/` (I'll branch `samarth/app-mic`)? Electron needs mic permission handling.
- @Noel, @Marco: team call on dropping Spell it / `/complete` from the demo.
- @Noel: should `highStakes` drive your second confirm? I'll add it to `/replies`.

## Run and check
```sh
cd conversation && npm install && cp .env.example .env && npm start   # http://localhost:8790/patient.html (Chrome)
npm run eval      # 28 nurse phrases: replies, latency, consent rule, NOT ADDRESSED flags
```
Offline: `MOCK_REPLIES=1 MOCK_VOICE=1 npm start`. Keys: same `CARTESIA_API_KEY` and `CARTESIA_VOICE_ID` as Samarth to get his cloned voice.
