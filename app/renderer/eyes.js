// Camera eye input. The vision module (../vision, bundled into vendor/eyes.js by `npm run eyes`)
// runs MediaPipe's face model on this machine and owns everything about the eyes: calibration,
// which box the patient is looking at, blink and squint holds, rests (eyes closed 3 s), face
// found/lost, and fatigue. This file only turns its output into the handlers app.js provides.
// app.js decides what each event does on screen. Without a camera or the bundle, the keyboard works.
//
// Calibration runs every launch: lighting, posture, and the laptop's position change between sessions.
// Its timing and dot order are the vision module's (see vision/src/cv/calibration.ts).

// Every handler app.js must provide. Checked at startup, so a missing one fails loudly instead of
// throwing on every camera frame.
const HANDLERS = ['status', 'calibration', 'calibrated', 'hold', 'focus', 'select', 'blink', 'rest', 'face', 'fatigue'];

// Quadrants: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'; null = the rest circle in the middle, no box.
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
  const { EyePipeline, FaceTracker, openWebcam } = vision;
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

  // The status line in the demo panel ends with the tracker's frame rate, updated about once a
  // second: a low rate (under ~20) is a common reason the eyes feel slow.
  let statusText = '';
  let fps = 0;
  const status = (text) => {
    statusText = text;
    on.status(fps ? `${text} · ${fps} fps` : text);
  };
  let frames = 0;
  let fpsSince = performance.now();

  const pipeline = new EyePipeline({ calibration: { layout: 'quadrants' } });

  function calibrate() {
    pipeline.startCalibration();
    status('Eyes: calibrating…');
  }

  calibrate();
  // Once per new camera frame (~30 fps). A requestAnimationFrame loop ran at the display's rate
  // instead (120 Hz on a MacBook Pro, where video.currentTime advances every refresh), so the face
  // model ran ~110 times a second on the page's main thread: everything lagged, and the vision
  // module's 3-frame blink filter shrank to ~28 ms, so a noisy frame could start a hold.
  const loop = () => {
    video.requestVideoFrameCallback(loop);
    frames++;
    const now = performance.now();
    if (now - fpsSince >= 1000) {
      fps = Math.round((frames * 1000) / (now - fpsSince));
      frames = 0;
      fpsSince = now;
      status(statusText);
    }
    const { frame } = tracker.detect(video, performance.now());
    const out = pipeline.process(frame);

    if (out.mode === 'calibrating' && out.calibration) {
      on.calibration(out.calibration.phase !== 'done' ? out.calibration : null);
    } else {
      on.calibration(null);
    }

    if (out.mode === 'running') {
      on.hold(out.blink ?? null);
      on.focus(out.quadrant?.focus ?? null);
    }

    for (const e of out.events) {
      if (e.type === 'quadrantSelect') on.select(e.quadrant);
      else if (e.type === 'blink') on.blink(e.durationMs);
      else if (e.type === 'rest' || e.type === 'restEnd') on.rest(e.type === 'rest');
      else if (e.type === 'faceLost' || e.type === 'faceFound') on.face(e.type === 'faceFound');
      else if (e.type === 'fatigue') on.fatigue(e.level);
      else if (e.type === 'calibrated') {
        status(`Eyes: camera (${tracker.delegate}), calibrated`);
        if (e.result.warnings.length) console.warn('calibration:', e.result.warnings.join('; '));
        on.calibrated(e.result);
      } else if (e.type === 'calibrationFailed') {
        status(`Eyes: calibration failed (${e.reason}). Press C to retry.`);
      }
    }
  };
  video.requestVideoFrameCallback(loop);

  return { calibrate };
}
