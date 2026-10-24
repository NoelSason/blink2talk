# Blink2Talk app

The patient screen as a full-screen desktop app (Electron). Plain HTML, CSS, and JavaScript, with no framework. It brings together the conversation server (`../conversation`: Claude replies, Cartesia voice and speech-to-text) and the eye tracker (`../vision`: MediaPipe gaze and blinks).

## Run it

From the repo root:

```sh
./start                          # installs what's missing, then opens full screen
BLINK2TALK_WINDOWED=1 ./start    # 1440×900 window
```

Keys go in `conversation/.env` (see `conversation/README.md`): `ANTHROPIC_API_KEY`, `CARTESIA_API_KEY`, and `CARTESIA_VOICE_ID` for the patient's cloned voice. Without them the app still runs, with sample replies, the system voice, and no mic.

`npm start` (here in `app/`) does the same as `./start` once everything is installed. It bundles `../vision` into `renderer/vendor/`, starts the conversation server if nothing answers on `http://localhost:8787`, and stops it on quit.

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

- **Consent:** a yes or no to a consent or treatment question (the conversation server answers those with Yes / No / Explain more only) is confirmed with "Is that right?" before it's spoken.

## How the gaze works

`renderer/gaze.js` decides which box the patient is looking at; the vision module still handles calibration, blink and squint holds, rest, and fatigue. The vision module's own box guess uses eye-in-head features only, fit once, so it drifts when the head turns toward a box or the head or camera moves. gaze.js:

- **Head-aware:** adds head turn, head tilt, and face position (from the same face landmarks) to the eye features, and maps them to a point on the grid with a ridge regression.
- **Self-correcting:** refits whenever it learns where the patient really looked: calibration, every practice pick (the marked box, even on a miss), every reply spoken without an undo, and every re-center.
- **Re-centers on its own:** if the head or camera moves away from where it was calibrated for 2 s, it runs a 6 s re-center (center, then each box) at the next quiet moment. `E` runs one by hand.
- **Steady picks:** a pick is the box looked at most in the 0.5 s before the eyes closed, so closing lids can't drag it to the bottom row.
- **Responsive:** it runs once per camera frame (about 30 a second), with an adaptive filter that smooths a resting gaze and follows a moving one with little lag. A new box takes the highlight after 150 ms.
- **Sensitivity:** `]` makes smaller eye movements reach a box, `[` needs bigger ones. It starts at 1.2 and is kept between launches.
- **See it:** `G` shows a dot where it thinks the patient is looking. The demo panel's Eyes line ends with the camera's frame rate; under about 20 fps the highlight will feel slow.
- **Recordings:** each launch writes the eye and head numbers from every camera frame, with what calibration and practice say the patient was looking at, to `app/logs/` (git-ignored, no images). They're for tuning gaze.js on real sessions.

## For the nurse or family

- **Talk:** the mic streams to Cartesia Ink-2, the caption updates as the nurse speaks, and replies appear when they finish. It mutes itself while the patient's voice plays.
- **Care panel:** the small button in the bottom-right corner, or `N`. It holds alerts, vitals (not connected yet), the conversation, notes about the patient, and settings. Urgent picks badge the button, play a sound, and send a desktop notification.
- **Memory:** the notes, and the phrases the patient picks most, go to Claude with every question. They're stored on this machine only.

## Keys

| Key | What it does |
|---|---|
| Arrow keys | Move the highlight around the grid |
| Space, held about 1 s | Long blink: choose |
| Space, Space | Double blink |
| `N` | Care panel |
| `D` | Demo controls: type what the nurse says, sample questions, sources |
| `Q` / `R` | Next sample question / back to Listening |
| `M` / `C` / `E` / `G` | Mic on or off / calibrate again / re-center the eyes / show the gaze dot |
| `[` / `]` | Eyes less / more sensitive |
| `T` / `F` / `L` | Tired mode / pretend the face is lost / light theme |

## Tests

```sh
npm test   # in app/: gaze model unit tests, then the real page off-screen (about 30 s)
```

It runs on sample replies with the camera and mic blocked, so it gives the same result every time. Camera events go straight into the handlers the vision module calls, so a broken tracker-to-screen contract fails the test. It covers the grid, the middle band, selecting each corner, "None of these" and back, double blinks walking back out of Spell it, Can't see you, tired mode (including while replies load), consent confirmation, undo while speaking, Spell it, and where the calibration dots land. The vision module has its own unit tests (`cd ../vision && npm test`). Neither measures real-camera accuracy; the practice round does that.

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
