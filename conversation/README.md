# BlinkVoice: Conversation server

Nurse speech in, 3-4 predicted patient replies out, chosen reply spoken in the patient's cloned voice (Cartesia Sonic).

## Setup
```
npm install
cp .env.example .env     # add ANTHROPIC_API_KEY and CARTESIA_API_KEY
npm run clone -- clip.wav   # ~30 s of the patient's voice -> prints CARTESIA_VOICE_ID, add to .env
npm start                   # http://localhost:8787 (test page)
```
With no keys it runs in mock mode (canned replies, browser voice).

## API
- `POST /replies {transcript, history?, patientProfile?, fatigue?}` -> `{replies[], urgent[], spellOption, source, ms}`
- `POST /complete {prefix, sentenceSoFar?, context?}` -> `{words[]}`
- `POST /speak {text}` -> `audio/wav` (204 in mock mode)

## Cartesia features used
Instant voice cloning (`voices.clone`), Sonic 3.6 TTS (`tts.generate`), in-memory audio cache for urgent phrases. API keys stay on the server.

## Safety design
Urgent options ("I'm in pain", "I can't breathe", "Call the nurse") are hard-coded, never model-generated. Consent/treatment questions return only Yes / No / Explain more. "None of these, I'll spell it" is always offered. If Claude fails, the server falls back to Yes / No / Explain more.

## Known limitations
- Consent detection is a keyword list, so it can miss rephrasings.
- `/speak` waits for the full audio (no streaming yet).
- STT is the browser Web Speech API (Chrome) for now.
