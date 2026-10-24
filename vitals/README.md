# Blink2Talk vitals (Patient state)

Pulse and breathing from the same webcam, via Presage SmartSpectra, for the nurse window. Owner: Marco.
Vitals are a wellness indicator, not a monitor (see CLAUDE.md, Known limitations).

## What this owns

- The `vitals` event: `{ pulse, breathing, confidence: { pulse, breathing }, t }`. Confidence 0 means "measuring".
- The nurse window (CLAUDE.md build step 3): transcript + pulse/breathing with confidence, static layout.
- Nothing else. Gaze and blink are `vision/`, replies and voice are `conversation/`, the shell is `app/`.

## Plan

1. `MOCK_VITALS=1` emitter (`src/mock.js`). Done. Lets the nurse window be laid out before anyone has a Presage key.
2. Real feed: `@smartspectra/node-sdk` Electron entry points. Main process `bindSmartSpectraIpc(win)`, `require('@smartspectra/node-sdk/preload')` from the app's preload, renderer `SmartSpectraSDK` with `useMediaStream(stream)` on the stream MediaPipe already opened. Decode with `decodeMetrics(buf)` and map to the `vitals` shape.
3. Nurse window: second `BrowserWindow`, dark theme, large type, transcript on the left, two tiles on the right. Pending Noel's call (see `context/patient-state.md`).

## Why the SDK's Electron path and not a hand-written frame pipe

CLAUDE.md describes a `frame` channel (RGBA `ImageData` + `timestampUs`, renderer to main over a `MessagePort`). The SDK's renderer entry does exactly that internally (`MediaStreamTrackProcessor` + `OffscreenCanvas`, RGBA over a `MessagePort`, one SDK per renderer in main). Writing our own would reproduce it with more bugs.

## Run

```sh
npm install                 # downloads native runtimes for every platform, a few hundred MB; expected
npm run mock                # one vitals JSON line per second
```

Key goes in `.env` as `SMARTSPECTRA_API_KEY` (copy `.env.example`). Main process only. macOS Apple Silicon is supported; Node 20+.

## Integration notes for `app/`

- The SDK's renderer worker runs from a `blob:` URL: the CSP needs `worker-src 'self' blob:`.
- The SDK preload must be required from `app/preload.js`; the sample assumes `contextIsolation: true, sandbox: true`.
- Camera permission goes through Electron's permission handler; grant `media` to our own page only.
- Two `getUserMedia` calls on one webcam may fail on macOS, so share the stream MediaPipe opened.
