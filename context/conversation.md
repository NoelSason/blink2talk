# Conversation context (owner: Samarth)

Updated: 2026-10-25 01:30 PDT

## Now
- Working on: `/replies` matches the contract (exactly 3 `{text, intent}`, `highStakes`, `rejected`, `category`), merged with Noel's speaker/highStakes/summary changes. `patient.html`: push-to-talk default, "None of these" -> re-ask -> 4 topics -> spell.
- Next: Noel wires `rejected`/`category` into the app. Replies now on Opus 5.5 fast (1.2 s median); timeout 5 s default, `.env.example` 8 s.
- Blocked on: team agreeing to keep Spell it (see below).

## Build-order status
- Step 1 (PTT, STT, Claude, TTS): done. `patient.html` hold N = push-to-talk on Ink-2. Noel's app has its own Ink-2 mic using `/stt-token`.
- Step 2 (mocks): `MOCK_REPLIES`, `MOCK_VOICE`; fall back automatically with no keys. Mock replies are exactly 3 with intents, and honor `category`. No STT mock; typed input stands in.
- Step 4 ("none of these" flow): server done (`rejected`, `category`). `patient.html` implements it. Noel's app to wire it.

## Interfaces as built
HTTP on `localhost:8790` (Noel's `main.js` proxies it over IPC):
- `POST /replies {transcript, history?, patientProfile?, fatigue?, speaker?, rejected?, category?, local?}` -> `{options: [{text, intent}] x3, replies: string[3], highStakes, about, addressed, speaker, urgent[], spellOption, source, ms}`
  - `highStakes`: Claude decides (`high_stakes`); keyword rule only on mock/fallback. Replies then Yes / No / I need more time; `about` = what a yes agrees to.
  - `rejected`: replies already turned down. `category`: `pain|comfort|people|question`.
  - `speaker` in `{voice, label?, isNew?}`, out `{label, role}` or null.
- `GET /config` -> includes `categories`, `localModel`.
- `POST /summary {history, patientProfile?}` -> `{forPatient, forCaregiver[], source}` (Opus 5.5; 204 mock, 502 failed). Noel's.
- `POST /complete {prefix, sentenceSoFar?, context?}` -> `{words[]}`
- `POST /speak {text}` -> `audio/wav` (204 = mock)
- `GET /stt-token` -> `{token}` (1 h, STT-only; 204 = mock)
- STT: browser streams to Cartesia Ink-2 with that token. Push-to-talk: release = done. Always-on (M in `patient.html`): `turn.end` = done.
- Browser hook: `window.blinkvoice.select/gazeLeft/gazeRight/setFatigue`.

## Deviations from CLAUDE.md
| Date | CLAUDE.md says | We did | Why | Affects | CLAUDE.md updated? |
| --- | --- | --- | --- | --- | --- |
| 2026-10-24 | IPC events `options`/`transcript`/`speak` | HTTP routes; Noel's `main.js` bridges to IPC | Server built standalone first | Product | no, bridge works |
| 2026-10-25 | `options` = `{ replies: [{text, intent}] }` | `options: [{text, intent}]` plus `replies: string[]` (same 3 texts) | Noel's app reads `replies` as strings; nothing breaks while he switches | Product | no |
| 2026-10-25 | Push-to-talk only | PTT default; always-on Ink-2 kept behind M in `patient.html` | Hands-free nurse option for later | Product | no |
| 2026-10-24 | "None of these" added by the UI | Server still returns `spellOption` string (unused by `patient.html` now) | Legacy field | Product | no |
| 2026-10-24 | No such thing | Hard-coded `urgent[]` ("I'm in pain", "I can't breathe", "Call the nurse") | Never rely on a model for emergencies | Product, Input | no. Fixed options, not alerts |
| 2026-10-24 | No such thing | `addressed` flag; room talk gets "Reply anyway" | Mic hears everyone | Product | no |
| 2026-10-24 | Local LLM cut | Noel's testing-only `local: true` (Qwen3-4B), off by default | Noel's testing switch | Product | yes (Noel's log entry) |

## CUT ITEM: Samarth wants to keep it (needs team sign-off + CLAUDE.md edit)
`POST /complete` and spelling are the free text CLAUDE.md cuts. Samarth's call: keep it, as the 3rd "None of these" step. @Marco @Noel: agree, then move it off the Cut list in CLAUDE.md.

## Decisions (newest first)
- 2026-10-25: "None of these" on a yes/no question (first set has intents `yes` and `no`) skips the re-ask and goes to the topic picker; open questions (where/what/how) still re-ask. Questions back only when natural. Why: a patient who slept badly picks No; a re-ask only gave reworded noes or odd questions ("Is the room cold?"). @Noel: same rule would suit the app.
- 2026-10-25: Re-ask instruction sits next to the rejected list in the user prompt, not only in the system prompt: each new reply adds a detail (when, how much, which, someone else, question back), no reworded yes/no. Why: Haiku ignored the system rule ("Call her now" = yes). 1 slip in 6 test questions.
- 2026-10-24 (Noel): `eval:replies` has a held-out set. The reply prompt was tuned on the 37 phrases it was then scored on, which flatters it, so `HELD_OUT` adds 34 new phrases written afterwards and never used to change the prompt; the summary reports `meanScoreTuned` and `meanScoreHeldOut`, and `SET=held-out` runs only those. Held out, Haiku + old prompt 3.76 (4 sets with rule problems, 1.53 s median / 2.42 s p90) -> Opus fast + new prompt 4.38 (0 problems, 1.16 s / 1.48 s): the gain holds, a little smaller than the tuned 3.81 -> 4.51. Both still treat "Pharmacy says the antibiotic will be up in twenty minutes." as said to the patient. Rule: don't edit the prompt to fix a held-out phrase; write fresh held-out phrases after any prompt change. Caveat as before: the grader is Opus, the same model as the new replies.
- 2026-10-24 (Noel; @Samarth please review): replies on `claude-opus-5-5` in fast mode (`CLAUDE_FAST`, beta `fast-mode-2026-02-01`, one standard-speed retry on a 429) with the server-side refusal fallback (`fallbacks: "default"`), and a rewritten SYSTEM prompt: replies fit the question type (yes/no = one yes, one no, one in-between; scales = number ranges; either/or = each option), 2-6 words, no echoing the question, no invented people or symptoms. Exact repeats are dropped. Spell it words stay on Haiku (`COMPLETE_MODEL`). Measured with the new `npm run eval:replies` (37 labeled phrases; rule checks, high-stakes and room-talk labels, latency, a 1-5 grade from Opus): Haiku + old prompt 3.81, 2 sets with rule problems, 1.33 s median / 2.08 s p90 -> Opus fast + new prompt 4.51, 0 problems, 1.21 s / 1.48 s. High stakes and room talk right on all 37 either way. Rejected: Sonnet 5.5 (4.27, 1.50 s), Opus at standard speed (4.54, 2.33 s). Caveat: the grader is Opus too.
- 2026-10-25: "None of these" re-ask stays on the question (more specific / partial / later), never an unrelated need. Why: first version jumped from "thirsty" to "raise my head". The topic picker handles changing subject.
- 2026-10-24 (Noel; testing-only local path): local `/replies` passes `rejected` to the model, and the local prompt has five worked examples (choice questions get the choices, yes/no questions get Yes / No / A little); the list grammar allows plain words only (no periods, ≤ 40 chars) after a reply ran on into emoji. 0.10–0.15 s per reply.
- 2026-10-25: Removed the Ink-2 turn `config` message from `patient.html` after Noel found it stops transcription. Eager-end prefetch stays.
- 2026-10-25: Claude timeout default 3 s -> 5 s (`.env.example` 8 s wins if set). If a "None of these" re-ask still falls back, `patient.html` skips to topics, then spelling. Why: fallback Yes/No looked like the button did nothing.
- 2026-10-25: Server drops model replies starting "None of these", requires exactly 3 (local model may return strings; accepted). Why: contract says the UI owns "none".
- 2026-10-25: Consent replies Yes / No / "I need more time" (was "Explain more"), per CLAUDE.md.
- 2026-10-25: Push-to-talk buffers mic audio until the socket opens and reuses a 50-min token. Why: first words lost on key press.
- 2026-10-24 (Noel; testing-only local path): `local.ts` returns short plain lists (`localList`, " | " under a GBNF grammar) instead of JSON; local `/replies` uses the keyword rule for high stakes, no speaker label, empty `intent`. 0.12-0.25 s per reply on an M3 Max. Claude path unchanged.
- 2026-10-24 (Noel, submission audit): `.env.example` gains `REPLIES_TIMEOUT_MS=8000` and `SUMMARY_MODEL`; `engines.node >=22.9`.
- 2026-10-24 (Noel; reviewed by Samarth 10-25, kept): `highStakes` + `about` from Claude; keyword rule only when the model doesn't answer. `voice.ts` dedupes concurrent synthesis and retries once.
- 2026-10-24 (Noel; reviewed, kept as testing-only): `local: true` on `/replies` and `/complete` (`src/local.ts`), `POST /local-warm`, `config.localModel`.
- 2026-10-24 (Noel; reviewed, kept): `speaker` in/out on `/replies`, `POST /summary`.
- 2026-10-24: Mic sends silence while the patient's voice plays. Why: stop the patient being transcribed as the nurse.
- 2026-10-24: Browser gets a short-lived STT-only token, never the API key.
- 2026-10-24: Default model `claude-haiku-5-5`. Why: median ~1.2 s vs seconds on Opus.
- 2026-10-24: Cartesia for STT + TTS + clone (CLAUDE.md log). Rejected: ElevenLabs.

## Open questions / needs from others
- @Noel: suggest the app skip the re-ask when the first set had `yes` and `no` intents (go to topics); see Decisions. `options[].intent`, `rejected`, `category`, `config.categories` are live. Your first "None of these" can send `rejected: [shown replies]`; second can show the 4 topics and send `category`. Consent third option is now "I need more time".
- @Noel, @Marco: keep Spell it (Samarth's call)? Needs CLAUDE.md Cut list edit.

## Run and check
```sh
cd conversation && npm install && cp .env.example .env && npm start   # http://localhost:8790/patient.html (Chrome)
npm run eval      # nurse phrases: replies, latency, consent rule, NOT ADDRESSED flags
```
Offline: `MOCK_REPLIES=1 MOCK_VOICE=1 npm start`. Keys: same `CARTESIA_API_KEY` and `CARTESIA_VOICE_ID` as Samarth to get his cloned voice.
