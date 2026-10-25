# Blink2Talk app

The patient screen as a full-screen desktop app (Electron). Plain HTML, CSS, and JavaScript, with no framework. It brings together the conversation server (`../conversation`: Claude replies, Cartesia voice and speech-to-text) and the eye tracker (`../vision`: MediaPipe gaze and blinks).

## Run it

From the repo root:

```sh
./start                          # installs what's missing, then opens full screen
BLINK2TALK_WINDOWED=1 ./start    # 1440×900 window
```

Keys go in `conversation/.env` (see `conversation/README.md`): `ANTHROPIC_API_KEY`, `CARTESIA_API_KEY`, and `CARTESIA_VOICE_ID` for the patient's cloned voice. Without them the app still runs, with sample replies, the system voice, and no mic.

`npm start` (here in `app/`) does the same as `./start` once everything is installed. It bundles `../vision` into `renderer/vendor/`, downloads the speaker-recognition model into `models/` the first time (~100 MB), starts the conversation server if nothing answers on `http://localhost:8790`, and stops it on quit.

## How the patient uses it

Every choice sits in a 2×2 grid with the boxes pushed into the screen's corners, so each target is a big box as far from the others as the screen allows. Look at a box to highlight it, then close your eyes or squint for about a second and open them to choose it. The question sits in the band between the two rows: looking there highlights nothing.

- **Listening:** "I want to say something" opens the urgent options and Spell it.
- **Replies:** Claude's three suggestions and "None of these", which opens the urgent options ("I'm in pain", "I can't breathe", "Call the nurse") and Spell it.
- **Spell it:** each pick narrows the letters until one is left. E, T, A, and O take two picks; every other letter takes three. The bottom-right box holds Claude's suggested words, then Space, Delete, Speak, and Back.
- **Blink twice:** undoes a pick, or goes back one page: up a level in Spell it, then out of Spell it to where it was opened, then from the urgent options to the replies or Listening.
- **Room talk:** when Claude judges the speech wasn't meant for the patient ("grab the chart from room 4"), the screen stays quiet and offers "Reply anyway" next to the urgent options.

Every launch starts with eye calibration, because lighting, posture, and the laptop's position change between sessions: look at the dot in the center, then at each corner where the boxes will be, then squint (about 15 s). Turning your head a little toward a dot is fine. Calibrate again any time with three quick blinks, the Calibrate button, or `C`; the Re-center button or `K` runs a quicker 8 s check if the boxes drift.

- **High-stakes answers:** when a yes or no would make a medical decision (consent to a treatment, a procedure, a medication change, CPR), the replies are Yes / No / Explain more, and a Yes or No is confirmed before it's spoken: "You said “Yes” to more pain medication. Is that correct?" with "Yes, that's right" on the left and "No, go back" on the right. Only left or right counts there, the direction the eye tracker reads best. Ordinary questions ("are you in pain?", "okay with the lights off?") aren't confirmed.
- **Blink three times quickly:** offers "Calibrate your eyes again?". Two quick blinks still go back; quick blinks count even when they're fast.

## How the gaze works

The vision module (`../vision`) owns the eyes: calibration (3 s countdown, then 2 s on the center, each box's outer corner, and a squint), which box the patient is looking at (left/right and top/bottom decided on separate axes, a rest zone in the middle, 300 ms focus dwell), blink and squint holds, rest, face found or lost, and fatigue. `renderer/eyes.js` only maps its output onto the screen; `renderer/view.js` places the calibration dots on the box corners, and each box shows a small mark in that corner so the patient glances toward it (the biggest eye movement the screen allows). Nothing about the eyes is decided in the app. To tune the gaze, change the vision module and its tests.

A pick that is spoken and not undone teaches the chosen box where the eyes were just before the hold (`pipeline.learn`, 20% of the gap per lesson), so the boxes follow slow drift from posture and eyelids without a recalibration. Dev mode (backtick) can turn this off.

**WebEyeTrack (test).** [WebEyeTrack](https://github.com/RedForestAI/WebEyeTrack) (MIT) runs alongside the vision module: a small neural network that predicts a point on the screen from an eye crop plus head pose and adapts from a few labeled points (our calibration dots, then every spoken pick, which teach both trackers). It runs in a Web Worker with its own copy of MediaPipe, fed the same camera frames. `G` (or the "Eyes:" button, or dev mode) swaps which one drives the boxes, instantly; a label flashes the active one. The eye log records both trackers' boxes every frame (`vf`, `wf`, `wp`), so one session scores both. Blink, squint, rest, and fatigue still come from the vision module. `npm run gaze` vendors the bundle into `renderer/vendor/` with its URLs pointed at this app; the weights are in `renderer/web/`. Smoke test: `npx electron test/webeyetrack-smoke.js`.

## For the nurse or family

- **Talk:** the mic streams to Cartesia Ink-2, the caption updates as the nurse speaks, and replies appear when they finish. A turn ends after at most 1.5 s of quiet, and replies start as soon as Ink-2 thinks the nurse is probably done. If the nurse pauses mid-question and keeps going within 6 s, before the patient picks, both parts become one question with one set of replies. It mutes itself while the patient's voice plays.
- **Fast replies on this laptop (testing only):** a switch in the care panel's Settings. Replies and word suggestions come from a small model running on the laptop instead of Claude: quicker, less accurate, not for patients. It's greyed out until the model is downloaded (`cd conversation && npm run local-model`, ~2.5 GB).
- **Care panel:** the small button in the bottom-right corner, or `N`. It holds alerts, a summary of the conversation, the conversation with who said each line, notes about the patient, and settings. Urgent picks badge the button, play a sound, and send a desktop notification.
- **Memory:** the notes, and the phrases the patient picks most, go to Claude with every question. They're stored on this machine only.
- **Who said what:** every line in the conversation is labeled with who said it ("Dr. Lee", "Your daughter"). A speaker-recognition model on this laptop (NVIDIA TitaNet-Large, run by sherpa-onnx in `speakers.js`) tells voices apart, so the same person keeps the same label; Claude names each voice from what it says. Voice prints stay in memory for one launch and never leave the laptop. Typed or sample questions skip the voice model.
- **Summary:** a couple of seconds after each exchange, Claude (Opus 5.5) summarizes the conversation twice: a few plain sentences for the patient, shown as "So far" on Listening, and bullet points for the care panel's Summary, including anything still unanswered. Without the conversation server, both show the last few lines as said.

## Keys

| Key | What it does |
|---|---|
| Arrow keys | Move the highlight around the grid |
| Space, held about 1 s | Long blink: choose |
| Space, Space | Double blink |
| `N` | Care panel |
| `D` | Demo controls: type what the nurse says, sample questions, sources |
| `Q` / `R` | Next sample question / back to Listening |
| `M` / `C` / `K` | Mic on or off / calibrate again / 8 s drift check |
| `` ` `` | Dev panel (timings, live eye readout) |
| `T` / `F` / `L` | Tired mode / pretend the face is lost / light theme |

## Tests

```sh
npm test   # in app/: voice-matching unit tests, then the real page off-screen (about 40 s)
```

It runs on sample replies with the camera and mic blocked, so it gives the same result every time. Camera events go straight into the handlers the vision module calls, so a broken tracker-to-screen contract fails the test. It covers the grid, the middle band, the summary on Listening and in the care panel, selecting each corner, "None of these" and back, double blinks walking back out of Spell it, Can't see you, tired mode (including while replies load), consent confirmation, undo while speaking, Spell it, and where the calibration dots land. The vision module has its own unit tests (`cd ../vision && npm test`). Neither measures real-camera accuracy.

## For other eye trackers

```js
window.blinkvoice.gazeLeft(); window.blinkvoice.gazeRight();
window.blinkvoice.select();          // picks what's highlighted
window.blinkvoice.setFatigue(0.8);   // 0..1; 0.6 and up turns on tired mode
window.dispatchEvent(new CustomEvent('patient-input', { detail: { type: 'eyes', closed: true } }));
```

## Where the design comes from

- `renderer/tokens.css` is copied unchanged from the Claude Design project. Paste a newer copy over it to update.
- The reply cards and end options follow `ReplyCard` and `EndOption` in the Claude Design project. Listening, Speaking, tired mode, and Can't see you follow the Figma file: https://www.figma.com/design/qhB3qvr3odYDYNlIcyNwy3
- The 2×2 grid replaces the original single row so the camera can target each box (the vision module's quadrant layout).
- Icons are Lucide SVGs in `renderer/icons/`, used as CSS masks so they take the text color in both themes.
