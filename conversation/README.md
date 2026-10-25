# BlinkVoice: Conversation server

Nurse speech in (Cartesia Ink-2), 3 predicted patient replies out (Claude), chosen reply spoken in the patient's cloned voice (Cartesia Sonic).

## Setup
```
npm install
cp .env.example .env     # add ANTHROPIC_API_KEY and CARTESIA_API_KEY
npm run clone -- clip.wav   # ~30 s of the patient's voice -> prints CARTESIA_VOICE_ID, add to .env
npm start                   # http://localhost:8790/patient.html (patient screen), / (API test page)
```
With no keys it runs in mock mode (canned replies, browser voice, Chrome Web Speech mic). Set `MOCK_REPLIES=1` / `MOCK_VOICE=1` to force it. Use Chrome.

Cloned voices belong to the Cartesia account that made them. To use the same voice, use the same `CARTESIA_API_KEY` and `CARTESIA_VOICE_ID`.

## Patient screen (`public/patient.html`)
States: listening -> thinking -> options -> speaking, plus spelling. Urgent options are always on screen.

Keyboard stand-ins: ←/→ move, Space select. Nurse mic: **hold N** (or the button) to talk, release to send. **M** toggles an always-on mic where Ink-2 decides when the nurse is done. Or type what the nurse said in the box and press Enter (fallback if the mic fails).

"None of these": 1st re-asks Claude with the rejected replies, 2nd offers four topics (pain, body/comfort, people, question), 3rd opens spelling.

## For Input (blink / gaze)
Your detector drives the screen by calling these on the patient page (load your script into `patient.html`):
```js
window.blinkvoice.gazeLeft()     // move highlight back
window.blinkvoice.gazeRight()    // move highlight forward
window.blinkvoice.select()       // deliberate long blink = choose highlighted option
window.blinkvoice.setFatigue(f)  // 0..1; sent to Claude so tired patients get fewer, shorter options
```
These do exactly what ←, →, Space do, so test with the keyboard first. Debounce and long-blink detection happen on your side: call `select()` once per intended selection.

## API
- `POST /replies {transcript, history?, patientProfile?, fatigue?, speaker?, rejected?, category?}` -> `{options: [{text, intent}] (exactly 3), replies[] (same texts), addressed, speaker, highStakes, about, urgent[], spellOption, source, ms}`. `rejected`: replies the patient said "none of these" to (Claude gives three different intents). `category`: `pain` | `comfort` | `people` | `question` (listed in `/config` `categories`). The UI adds "None of these"; the model never does. `highStakes` (Claude's call; the keyword rule only as a fallback) means a yes or no makes a medical decision; then the replies are Yes / No / I need more time (after "None of these", fixed clarifying replies such as "Please explain it again") and `about` says what a yes agrees to ("more pain medication"). `addressed: false` = speech wasn't meant for the patient (screen stays quiet, offers "Reply anyway"). `speaker` in: `{voice, label?, isNew?}` from the app's voice model; out: `{label, role}` ("Dr. Lee", doctor), or null for the consent rule, mock, and fallback. History lines may carry `speaker`.
- Testing only: `/replies` and `/complete` take `local: true` to answer with a small model on the laptop (Qwen3-4B-Instruct via node-llama-cpp, `src/local.ts`), falling back to Claude if it fails. `POST /local-warm` loads it; `GET /config` reports `localModel`. Download the model once with `npm run local-model` (~2.5 GB). Not for patients; CLAUDE.md cuts a local LLM, so this stays a switch for testing.
- `POST /summary {history, patientProfile?}` -> `{forPatient, forCaregiver[], source}`. Uses `SUMMARY_MODEL` (default `claude-opus-5-5`), 30 s timeout. 204 in mock mode, 502 on failure (the app writes a plain one).
- `POST /complete {prefix, sentenceSoFar?, context?}` -> `{words[]}`
- `POST /speak {text}` -> `audio/wav` (204 in mock mode)
- `GET /stt-token` -> `{token}`: 1-hour, STT-only Cartesia access token for the browser mic (204 in mock mode)

## Cartesia features used
- **Instant voice cloning** (`voices.clone`): ~30 s clip -> the patient's own voice.
- **Sonic 3.6 TTS** (`tts.generate`): chosen reply spoken in that voice. Urgent and consent phrases are pre-generated at startup so they play instantly.
- **Ink-2 streaming STT with turn detection** (`/stt/turns/websocket`): the browser streams the nurse mic to Cartesia, and Ink's `turn.end` decides when the nurse is done, which triggers reply prediction. While the patient's voice plays, the mic sends silence so the patient isn't transcribed as the nurse.
- **Access tokens** (`accessToken.create`, STT grant only): the browser never sees the API key.

## Safety design
Urgent options ("I'm in pain", "I can't breathe", "Call the nurse") are hard-coded, never model-generated. Speech not addressed to the patient (staff talking to each other) is flagged by Claude, and the screen stays quiet, but "Reply anyway" and the urgent options are one blink away, so a wrong guess never silences the patient. Consent/treatment questions return only Yes / No / I need more time, flagged `highStakes`; after "None of these", fixed clarifying replies ("Please explain it again", "What are the risks?") that never make the decision. "None of these" is always offered and ends in spelling. If Claude fails or times out, the server falls back to fixed replies for the kind of question (Yes / No / Please ask again for a yes/no question; Please ask again / Ask me yes or no / I'm not sure for an open one), never one the patient already rejected.

## Known limitations
- High stakes is Claude's call. When Claude doesn't answer (mock mode, a timeout), a keyword list decides, which can miss rephrasings.
- `/speak` waits for the full audio (no streaming yet); new phrases take ~0.6 s.
- Addressee detection is a model judgment: ambiguous lines ("I'll be on break for 15 minutes") are treated as addressed.
- STT hears whoever is loudest. The app tells voices apart with a speaker-recognition model on the laptop (`app/speakers.js`) and Claude names them; the match threshold was set on synthetic voices. Falls back to Chrome Web Speech without a Cartesia key.
- Claude replies time out at 5 s by default (`REPLIES_TIMEOUT_MS`; `.env.example` sets 8 s) and fall back to fixed replies for the kind of question (see Safety design). Opus 5.5 in fast mode measured 1.21 s median, 1.48 s p90 on 37 phrases; venue Wi-Fi adds to that.
