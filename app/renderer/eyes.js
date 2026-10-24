// Camera eye input from the vision module (../vision, bundled into vendor/eyes.js by `npm run eyes`).
// It runs MediaPipe's face model on this machine in its quadrant layout: it reports which of four
// boxes the patient is looking at, holds (a long blink or a held squint) and which box they select,
// ordinary blinks, the face coming and going, and fatigue. app.js decides what each one does on
// screen. Without a camera or the bundle, the keyboard keeps working.

const STORAGE_KEY = 'blink2talk.calibration';

function loadCalibration() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return saved?.layout === 'quadrants' && typeof saved.thresholds?.close === 'number' ? saved : null;
  } catch {
    return null;
  }
}

function saveCalibration(result) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(result));
  } catch {
    // Storage unavailable: the calibration still applies until the app closes.
  }
}

// on: { status(text), calibration(progress | null), hold(state), focus(quadrant | null), select(quadrant | null),
//       blink(ms), face(found), fatigue(level) }. Quadrants: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'.
export async function startEyes(on) {
  let vision;
  try {
    vision = await import('./vendor/eyes.js');
  } catch {
    on.status('Eyes: keyboard (eye tracker not built; run npm run eyes)');
    return null;
  }
  const { EyeInput, EyePipeline, FaceTracker, openWebcam } = vision;
  const video = document.getElementById('camera');

  on.status('Eyes: loading the face model…');
  let tracker;
  try {
    tracker = await FaceTracker.create({ wasmPath: './mediapipe/wasm', modelPath: './models/face_landmarker.task' });
  } catch (err) {
    on.status(`Eyes: keyboard (face model didn't load: ${err?.message ?? err})`);
    return null;
  }
  try {
    await openWebcam(video);
  } catch (err) {
    on.status(`Eyes: keyboard (camera unavailable: ${err?.name ?? err})`);
    return null;
  }

  // Look at a box to focus it, hold to select it: matches the 2×2 grid of replies.
  const pipeline = new EyePipeline({ calibration: { layout: 'quadrants' } });
  const saved = loadCalibration();
  if (saved) pipeline.useCalibration(saved);
  else pipeline.startCalibration();
  const running = () => on.status(`Eyes: camera (${tracker.delegate}), calibrated`);
  if (saved) running();

  new EyeInput({
    video,
    tracker,
    pipeline,
    onFrame: (out) => {
      const c = out.mode === 'calibrating' ? out.calibration : null;
      on.calibration(c && c.phase !== 'done' ? c : null);
      if (out.mode === 'running') {
        on.hold(out.blink ?? null);
        on.focus(out.quadrant?.focus ?? null);
      }
      for (const e of out.events) {
        // The box that had focus when the hold started; null when the patient was on the rest circle.
        if (e.type === 'quadrantSelect') on.select(e.quadrant);
        else if (e.type === 'blink') on.blink(e.durationMs);
        else if (e.type === 'faceLost' || e.type === 'faceFound') on.face(e.type === 'faceFound');
        else if (e.type === 'fatigue') on.fatigue(e.level);
        else if (e.type === 'calibrated') {
          saveCalibration(e.result);
          running();
          if (e.result.warnings.length) console.warn('calibration:', e.result.warnings.join('; '));
        } else if (e.type === 'calibrationFailed') on.status(`Eyes: calibration failed (${e.reason}). Press C to retry.`);
      }
    },
  }).start();

  return {
    calibrate() {
      on.status('Eyes: calibrating…');
      pipeline.startCalibration();
    },
  };
}
