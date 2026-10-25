# Consent and privacy note

Draft for the team (Marco owns submission docs). Blink2Talk is a hackathon prototype, not a medical device. Use it only for demos and testing with people who agree to it.

## What to ask before using it with someone

- The person using it (or the person speaking for them) agrees to be filmed by the laptop camera and recorded by its microphone while the app is open.
- People talking near the patient know their speech is transcribed.
- The patient's voice is cloned only from a recording its owner gave for this purpose. The demo voice belongs to a team member who recorded it for the demo.

## What happens to the data

| Data | Where it goes | Kept |
|---|---|---|
| Camera frames | Processed on the laptop (MediaPipe); never sent anywhere | Not stored |
| Microphone audio | Streamed to Cartesia for speech-to-text while the mic is on | Not stored by the app |
| Voice prints (who is speaking) | Computed on the laptop | In memory for one launch only |
| Questions, replies, and notes | Sent to Anthropic (Claude) to suggest replies and summaries | The conversation and notes stay in the app's local storage on the laptop until cleared in the care panel |
| Chosen replies | Sent to Cartesia to speak in the cloned voice | Not stored by the app |

## Limits to say out loud

- Replies are suggestions; the patient chooses every word that's spoken.
- High-stakes answers (consent, medication, CPR) are confirmed on screen before they're spoken, but the care team should still confirm important decisions another way.
- The "Fast replies on this laptop" setting is for testing only and is less accurate.
