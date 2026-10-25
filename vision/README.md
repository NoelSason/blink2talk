# blink_to_talk

Computer-vision module for the Blink-to-Speak ICU Communicator (Cal Hacks 13.0):
long-blink / squint selection and gaze for awake, intubated, restrained ICU adults.

- **Select** with a long blink or a held squint (release after ≥ 800 ms); 3 s closed is `rest`, not a select.
- **Focus** one of four answer boxes by looking at it, so answers can be read without selecting anything.
- **Fatigue** signals — blink rate, blink duration, eyelid droop vs. the patient's own baseline — for UI pacing.
- On-device in the renderer, on MediaPipe's pretrained FaceLandmarker. No training, no network.

Everything else (Presage vitals, Claude reply prediction, Cartesia STT/TTS, the Electron shell) lives with
the rest of the team.

## Quick start

```bash
npm install --legacy-peer-deps   # npm 10.8 crashes ("edgesOut") without the flag
npm run dev                      # copies MediaPipe WASM + downloads the model, then serves :5173
npm test                         # 54 unit tests, no camera needed
npm run typecheck
```

Open in Chrome or Edge. From WSL, browse from Windows: localhost is forwarded and the browser owns the
webcam. **Use video file** on either page replays a recording instead of the webcam (`MOCK_CAMERA`).

- **Quadrants** — `/quadrants.html`: four touching boxes with a rest circle where they meet. Look at a box
  to focus it; reading inside a box, or a glance at another one under 300 ms, changes nothing. Select with
  a long blink or held squint — the squint keeps the eyes open enough to watch the hold bar fill. A hold on
  the rest circle selects nothing. **Edit options** rewrites the box text (saved in the browser).
- **Bench** — `/`: left/right gaze, EAR plot, fatigue stats, scan list. Auto-scan is off by default; on, it
  advances every 1.2 s.

## Calibration (~15 s quadrants, 11 s bench)

A 3 s countdown, then each dot for 2 s (with its own countdown; the first 0.5 s is ignored while the eyes
move). Order: center, the middle of each box (left and right on the bench), then a squint. Each box is "where
the eyes were while looking at it". Left/right and top/bottom are decided separately (`axisPosition`): each
axis uses only its own features (`gazeX`/`lookX`, `gazeY`/`lookY`), weighted by how many spreads they separate
the sides, with a rest zone around the center and hysteresis at the midlines. A recorded session showed why:
vertical features drift with the eyelids and head tilt within minutes, and in a joint nearest-centroid that
drift outweighed a strong left/right signal. Dots sit at fixed normalized `TARGET_POSITIONS` (the outer corners
of a 2×2 grid, ±0.9), the biggest eye movement the screen allows. `learnTarget` nudges a box's centroid toward
the look that preceded a pick the user let stand (`EyePipeline.learn`), so boxes follow slow drift.

- **Blink thresholds** come from the narrowest normal look, usually a bottom box, so looking down isn't
  mistaken for a blink.
- **Squint** compares the squint step against the most squint-like normal look, using whichever separates
  them better: EAR, or MediaPipe's `eyeSquint` blendshape. If the two can't be told apart, squint is turned
  off with a warning; full blinks still work.
- **Accuracy check:** logs per-box accuracy and warns when boxes are hard to tell apart. Move the screen
  closer or put the camera at eye level, then recalibrate.

## Layout

| File | What it does |
|---|---|
| `src/cv/features.ts` | Landmarks → per-frame `EyeFrame` (EAR, iris position, blendshape look direction and squint). Pure. |
| `src/cv/calibration.ts` | Dots → blink thresholds, gaze model, squint thresholds. |
| `src/cv/blink.ts` | Hold state machine (closed or squinting): select on release, refractory, rest, fill progress. |
| `src/cv/quadrant.ts` | Corner-calibrated per-axis classifier (left/right, top/bottom), rest zone at the center, hysteresis, 300 ms focus dwell, learning from kept picks. |
| `src/cv/gaze.ts` | Left/center/right with dwell, hysteresis and re-arm (bench). |
| `src/cv/fatigue.ts` | Blink rate, blink duration, eyelid droop vs. baseline. |
| `src/cv/pipeline.ts` | `EyePipeline`: `EyeFrame` in, UI state and events out. No DOM, no MediaPipe. |
| `src/cv/tracker.ts` | `FaceTracker`: MediaPipe wrapper, GPU with CPU fallback. |
| `src/cv/input.ts` | `EyeInput` frame loop and `openWebcam()`. |
| `src/demo/` | Test pages: `quadrants.ts`, `main.ts` (bench), `shared.ts`. |
| `test/` | Vitest unit tests on synthetic signals. |

## Integrating

This module owns *where the patient is looking and when they select*. It never sees answer text:
`quadrant.ts` works in box indices, and the demo's editable option strings live in `localStorage`, not in
`src/cv/`. The answers side produces four strings, the frontend places them, and we report which box was
chosen — so neither of those depends on the model or the calibration.

- `blink-to-talk` — renderer entry: pipeline + MediaPipe tracker + camera loop.
- `blink-to-talk/core` — the same logic without DOM or MediaPipe. Import `EyePipeline` and the event types
  from here; importing the root drags the MediaPipe WASM loader into whatever process does it.

The host app copies the model and WASM runtime into its own `public/` as part of its dev/build step:

```bash
node ../blink_to_talk/scripts/fetch-assets.mjs ./public
```

Those two URLs are the only path-dependent thing; pass them to `FaceTracker.create()`.

```ts
import { EyeInput, EyePipeline, FaceTracker, openWebcam } from "./blink_to_talk/src/cv";

const video = document.querySelector("video")!;
await openWebcam(video);
const tracker = await FaceTracker.create({ wasmPath: "./mediapipe/wasm", modelPath: "./models/face_landmarker.task" });
const pipeline = new EyePipeline({ calibration: { layout: "quadrants" } });
pipeline.startCalibration(); // dot at TARGET_POSITIONS[phase] (center for "ready" and "squint"); countdown = out.calibration.remainingMs

new EyeInput({
  video, tracker, pipeline,
  onFrame: (out) => {
    // out.quadrant.focus = box to highlight; out.blink.progress = hold bar
    for (const e of out.events) {
      if (e.type === "quadrantSelect" && e.quadrant) { /* answer in box e.quadrant (via e.via) */ }
      if (e.type === "rest") { /* PAUSED */ }
      if (e.type === "fatigue") { /* slow down, fewer options, notify nurse panel */ }
    }
  },
}).start();
```

`quadrantSelect.quadrant` is the box that had focus when the hold started, or `null` for the rest circle.
The same `video` element can feed the frames that go to Presage.

## Stack

`@mediapipe/tasks-vision` FaceLandmarker (pinned 0.10.35) in the renderer: `runningMode: "VIDEO"`,
`outputFaceBlendshapes: true`, `numFaces: 1`, `delegate: "GPU"` falling back to `"CPU"`. Webcam via
`getUserMedia({ video: { width: 1280, height: 720, frameRate: 30 } })`. EAR eye indices 33, 160, 158, 133,
153, 144 and 362, 385, 387, 263, 373, 380; iris centers 468 and 473.

## Risks

- **Caregiver face in frame:** one face is tracked; aim the camera so only the patient is in view.
- **Involuntary squints** (pain grimace, glare) can select. Raise the select hold if that happens.
- **Lighting:** diffuse lamp in front of the face, 45° off-axis. Avoid backlight.
- **Camera:** 1080p, 30 fps USB webcam at eye level, 50–70 cm away.
- **Metrics:** log the false-select rate. Report only our own measured numbers, never "clinically validated
  accuracy."
