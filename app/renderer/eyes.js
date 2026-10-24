// Camera eye input from the vision module (../vision, bundled into vendor/eyes.js by `npm run eyes`).
// It runs MediaPipe's face model on this machine in its quadrant layout: it reports which of four
// boxes the patient is looking at, holds (a long blink or a held squint) and which box they select,
// ordinary blinks, rests (eyes closed 3 s), the face coming and going, and fatigue. app.js decides
// what each one does on screen. Without a camera or the bundle, the keyboard keeps working.
//
// Calibration runs every launch: lighting, posture, and the laptop's position change between sessions.

// Every handler app.js must provide. Checked at startup, so a missing one fails loudly instead of
// throwing on every camera frame.
const HANDLERS = ['status', 'calibration', 'calibrated', 'hold', 'focus', 'select', 'blink', 'rest', 'face', 'fatigue'];

// Quadrants: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'; null = the rest circle in the middle.
export async function startEyes(on) {
  const missing = HANDLERS.filter((k) => typeof on[k] !== 'function');
  if (missing.length) throw new Error(`eyes.js: missing handlers ${missing.join(', ')}`);

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
  pipeline.startCalibration();
  on.status('Eyes: calibrating…');

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
        else if (e.type === 'rest' || e.type === 'restEnd') on.rest(e.type === 'rest');
        else if (e.type === 'faceLost' || e.type === 'faceFound') on.face(e.type === 'faceFound');
        else if (e.type === 'fatigue') on.fatigue(e.level);
        else if (e.type === 'calibrated') {
          on.status(`Eyes: camera (${tracker.delegate}), calibrated`);
          if (e.result.warnings.length) console.warn('calibration:', e.result.warnings.join('; '));
          on.calibrated(e.result);
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
