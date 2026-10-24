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

Every choice sits in a 2×2 grid, so each target is a big box the eye tracker can hit. Look at a box to highlight it, then close your eyes or squint for about a second and open them to choose it. The circle in the middle is a rest spot: looking there highlights nothing.

- **Listening:** "I want to say something" opens the urgent options and Spell it.
- **Replies:** Claude's three suggestions and "None of these", which opens the urgent options ("I'm in pain", "I can't breathe", "Call the nurse") and Spell it.
- **Spell it:** each pick narrows the letters until one is left. E, T, A, and O take two picks; every other letter takes three. The bottom-right box holds Claude's suggested words, then Space, Delete, Speak, and Back.
- **Blink twice:** undoes a pick, goes up a level in Spell it, or goes back from the urgent options.
- **Room talk:** when Claude judges the speech wasn't meant for the patient ("grab the chart from room 4"), the screen stays quiet and offers "Reply anyway" next to the urgent options.

The first launch calibrates the camera (about 15 s): look at the dot in the center, then in the middle of each box, then squint. Press `C` to calibrate again.

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
| `M` / `C` / `T` / `F` / `L` | Mic on or off / calibrate / tired mode / pretend the face is lost / light theme |

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
