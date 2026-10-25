# Blink2Talk

Blink2Talk lets an ICU patient who is awake but can't speak or use their hands answer by eye. A nurse or family member talks; the patient sees a few short replies in a 2×2 grid, looks at one, and closes their eyes or squints for about a second to choose it. The app says the reply in the patient's own voice.

Built at Cal Hacks 13.0.

## Eye accuracy

<!-- accuracy:start: written by app/accuracy.js after every calibration and accuracy test; edits here are overwritten -->
**Accuracy test: none recorded yet.**

**Calibrations (25 recorded, newest first).** How well each calibration's own looks sort back into the right box. This checks the fit, not accuracy: under 70% (bold) on any box means calibrate again.

| When | Tester | Center | Top left | Top right | Bottom left | Bottom right | Notes |
|---|---|---|---|---|---|---|---|
| Oct 24, 11:02 PM PDT | — | 100% | 80% | 100% | 100% | 100% |  |
| Oct 24, 10:34 PM PDT | — | 100% | 100% | 100% | 100% | 100% |  |
| Oct 24, 10:19 PM PDT | — | **22%** | **43%** | 93% | 80% | **49%** | hard to tell apart: center, top left, bottom right |
| Oct 24, 10:08 PM PDT | — | **39%** | 89% | 100% | 100% | 100% | hard to tell apart: center |
| Oct 24, 10:05 PM PDT | — | 77% | 100% | 100% | 100% | 100% |  |

Updated automatically after every calibration and accuracy test. Full history: [docs/accuracy.md](docs/accuracy.md).
<!-- accuracy:end -->

To add a result: open Dev mode (backtick), type who's testing (a first name or "Guest 1"; it goes into the repo), recalibrate, then run **Accuracy test (8 corners)**. The section above updates on its own. After pulling teammates' results, run `npm run accuracy` in `app/`.

## What it does

- **Hears the room.** The nurse's question appears as a live caption, labeled with who said it ("Dr. Lee", "Your daughter").
- **Suggests replies.** Claude proposes three short first-person replies, plus "None of these", which opens urgent phrases ("I'm in pain", "I can't breathe", "Call the nurse") and a speller.
- **Reads the eyes on the laptop.** A webcam and MediaPipe face landmarks find which box the patient is looking at and when they hold their eyes closed. Camera frames never leave the laptop.
- **Speaks in their voice.** The chosen reply plays in a cloned voice.
- **Guards high-stakes answers.** When a yes or no would make a medical decision (consent, a medication change, CPR), the patient confirms it: "You said “Yes” to more pain medication. Is that correct?"
- **Keeps the care team informed.** A care panel shows urgent alerts, a running summary of the conversation, and who said what. The patient's screen shows a short "So far" summary too.
- **Adapts to fatigue.** Tired mode shows fewer, larger replies.

## Run it

You need a Mac with a webcam (built and tested on macOS with Apple silicon), Node.js 22.9 or later, and API keys for Anthropic and Cartesia.

```sh
cp conversation/.env.example conversation/.env   # add ANTHROPIC_API_KEY, CARTESIA_API_KEY, CARTESIA_VOICE_ID
./start                                          # installs what's missing, then opens the app full screen
```

The first run downloads Electron, the MediaPipe face model, and a speaker-recognition model (about 100 MB), and macOS asks for camera and microphone access. Calibration starts right away: look at each dot, then squint. Without keys the app still runs, with sample replies and the system voice.

To try it without a patient, use the keyboard: arrow keys move the highlight, holding Space for a second chooses, and `D` opens demo controls with sample questions. `app/README.md` lists every key.

## How it's built

| Folder | What | Owner |
|---|---|---|
| `app/` | Electron patient screen, care panel, eye-input adapter, speaker recognition | Noel |
| `conversation/` | Server: Claude replies and summaries, Cartesia speech-to-text and cloned voice | Samarth |
| `vision/` | MediaPipe eye tracking: calibration, gaze boxes, blink and squint holds, fatigue | Julian |
| `context/`, `docs/` | Team context docs, decisions, worklog, submission | Marco |

`CLAUDE.md` is the team contract; each folder has its own README.

## Known limitations

- Not a medical device, and not tested with patients. Tested only by the team.
- Needs the patient to hold their gaze; no fallback for nystagmus or a swollen eye. Blink and squint thresholds aren't validated across eye shapes.
- Needs a network connection for replies, captions, and the voice. Slow Wi-Fi makes replies slow; the app falls back to safe Yes / No replies after a timeout.
- Speaker recognition was tuned on synthetic voices.

## Privacy

See `docs/consent.md` for what is recorded, where it goes, and what to ask before using the app with someone.
