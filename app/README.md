# Blink2Talk app

The patient screen as a full-screen desktop app (Electron). Plain HTML, CSS, and JavaScript, with no framework. Replies, word suggestions, and the patient's voice come from the conversation server in `../conversation`.

```sh
(cd ../conversation && npm install)                   # once; add keys to ../conversation/.env (see its README)
(cd ../vision && npm install --legacy-peer-deps)      # once; the camera eye tracker
npm install
npm start          # full screen
npm run windowed   # 1440×900 window, easier while building
```

`npm start` first runs `npm run eyes`, which bundles `../vision` into `renderer/vendor/eyes.js` and copies MediaPipe's runtime and face model into `renderer/`. Without them, the app runs on the keyboard only.

`npm start` also starts the conversation server if nothing is answering on `http://localhost:8787`, and stops it on quit. If the server can't start, the screen keeps working on sample replies and the system voice.

## Keys

The keyboard works alongside the camera and stands in for the patient's eyes:

| Key | Stands in for |
|---|---|
| Left / Right arrow | Look left / right |
| Space, held | Eyes closed. Hold about 1 s for a long blink, which selects. |
| Space, Space | Double blink, which undoes (on Selected or Speaking) |

Operator keys: `D` opens the demo controls (type what the nurse says, sample questions, sources). `Q` plays the next sample question, `R` goes back to Listening, `T` switches tired mode, `F` pretends the app lost the face, `C` recalibrates the camera, and `L` switches dark and light.

## Camera eye tracking

The vision module (`../vision`) runs MediaPipe's face model on this machine, in its left/right layout. The first launch calibrates: look at the dot in the center, on the left, on the right, then squint (about 11 s). Press `C` to calibrate again. The calibration is saved for the next launch.

| The camera sees | The app does |
|---|---|
| A glance left or right, held about 0.7 s | Moves the highlight |
| A long blink or held squint, released after 0.8 s | Selects |
| Two quick blinks | Undo |
| No face | Can't see you |
| Fatigue against the first 5 minutes | Tired mode |

## Connecting another eye tracker

Either API works from the page.

The blink/gaze module contract from `conversation/public/patient.html`, where the module detects the long blink itself:

```js
window.blinkvoice.gazeLeft(); window.blinkvoice.gazeRight();
window.blinkvoice.select();          // picks what's highlighted
window.blinkvoice.setFatigue(0.8);   // 0..1; 0.6 and up turns on tired mode
```

Raw events, where the app works out long blinks and double blinks from the timing:

```js
window.dispatchEvent(new CustomEvent('patient-input', { detail: { type: 'look', dir: 'right' } }));
window.dispatchEvent(new CustomEvent('patient-input', { detail: { type: 'eyes', closed: true } }));
```

## How it uses the conversation server

- `/replies` gets the nurse's words, the last 6 turns, the patient's name, and fatigue. The patient's picks go into the history.
- "None of these" asks again and tells the model which options didn't fit. The second one opens Spell it.
- `/complete` fills the predicted-words row in Spell it.
- `/speak` plays the patient's cloned voice when the server has a Cartesia key, and falls back to the system voice otherwise.
- The server's urgent options ("I'm in pain", "I can't breathe", "Call the nurse") are on Start a conversation, one long blink from Listening.
- The page is loaded from a file, so requests go through the main process (`main.js`) rather than `fetch`.

## Where the design comes from

- `renderer/tokens.css` is copied unchanged from the Claude Design project. Paste a newer copy over it to update.
- Suggested replies (moments 2a–2e) follow `RepliesScreen`, `ReplyCard`, and `EndOption` in the Claude Design project.
- Listening, Speaking, Spell it, tired mode, Can't see you, and Start a conversation follow the Figma file's screens: https://www.figma.com/design/qhB3qvr3odYDYNlIcyNwy3
- Icons are Lucide SVGs in `renderer/icons/`. They are used as CSS masks, so they take the text color in both themes.

## Not built yet

- The nurse's microphone. The browser speech recognition in `patient.html` works in Chrome, not Electron, so type in the demo controls for now.
- The care panel. The corner button does nothing yet.
