# Blink2Talk app

The patient screen as a full-screen desktop app (Electron). Plain HTML, CSS, and JavaScript, with no framework. It brings together the conversation server (`../conversation`: Claude replies, Cartesia voice and speech-to-text) and the eye tracker (`../vision`: MediaPipe gaze and blinks).

## Run it

From the repo root:

```sh
./start                          # installs what's missing, then opens full screen
BLINK2TALK_WINDOWED=1 ./start    # 1440×900 window
```

Keys go in `conversation/.env` (see `conversation/README.md`): `ANTHROPIC_API_KEY`, `CARTESIA_API_KEY`, and `CARTESIA_VOICE_ID` for the patient's cloned voice. Without them the app still runs, with sample replies, the system voice, and no mic.

`npm start` (here in `app/`) does the same as `./start` once everything is installed. It bundles `../vision` into `renderer/vendor/`, downloads the speaker-recognition model into `models/` the first time (~100 MB), starts the conversation server if nothing answers on `http://localhost:8787`, and stops it on quit.

## How the patient uses it

Every choice sits in a 2×2 grid with the boxes pushed into the screen's corners, so each target is a big box as far from the others as the screen allows. Look at a box to highlight it, then close your eyes or squint for about a second and open them to choose it. The question sits in the band between the two rows: looking there highlights nothing.

- **Listening:** "I want to say something" opens the urgent options and Spell it.
- **Replies:** Claude's three suggestions and "None of these", which opens the urgent options ("I'm in pain", "I can't breathe", "Call the nurse") and Spell it.
- **Spell it:** each pick narrows the letters until one is left. E, T, A, and O take two picks; every other letter takes three. The bottom-right box holds Claude's suggested words, then Space, Delete, Speak, and Back.
- **Blink twice:** undoes a pick, or goes back one page: up a level in Spell it, then out of Spell it to where it was opened, then from the urgent options to the replies or Listening.
- **Room talk:** when Claude judges the speech wasn't meant for the patient ("grab the chart from room 4"), the screen stays quiet and offers "Reply anyway" next to the urgent options.

Every launch starts with eye onboarding, because lighting, posture, and the laptop's position change between sessions:

1. **Calibration** (about 15 s): look at the dot in the center, then at each corner where the boxes will be, then squint. Turning your head a little toward a dot is fine.
2. **Practice:** four rounds, one marked box at a time, each corner once in random order. Look at it and close your eyes for a moment. The demo controls (`D`) show the result, for example "Practice: 4 of 4 correct, 2.3 s each". Press `C` to calibrate again if it's low.

- **Consent:** a yes or no to a consent or treatment question (the conversation server answers those with Yes / No / Explain more only) is confirmed before it's spoken: the question stays on screen above two tall boxes, Say "Yes" on the left and Go back on the right. Only left or right counts there, the direction the eye tracker reads best.

## How the gaze works

The vision module (`../vision`) owns the eyes: calibration (3 s countdown, then 2 s on the center, each box, and a squint), which box the patient is looking at (nearest calibrated target with a 300 ms focus dwell), blink and squint holds, rest, face found or lost, and fatigue. `renderer/eyes.js` only maps its output onto the screen; `renderer/view.js` places the calibration dots on the same box centers the grid uses. Nothing about the eyes is decided in the app. To tune the gaze, change the vision module and its tests.

## For the nurse or family

- **Talk:** the mic streams to Cartesia Ink-2, the caption updates as the nurse speaks, and replies appear when they finish. It mutes itself while the patient's voice plays.
- **Care panel:** the small button in the bottom-right corner, or `N`. It holds alerts, vitals (not connected yet), the conversation, notes about the patient, and settings. Urgent picks badge the button, play a sound, and send a desktop notification.
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
| `M` / `C` | Mic on or off / calibrate again |
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

## Not built yet

- Vitals: the care panel tiles wait for the Presage feed.
