// Camera eye input. The vision module (../vision, bundled into vendor/eyes.js by `npm run eyes`)
// runs MediaPipe's face model and owns calibration, box picking, blink and squint holds, rest, and
// fatigue. Three things here are dev-mode switches (devpanel.js), read live from `settings`:
//   - face.lostMs / face.foundMs: the vision module reports "face lost" on every dropped frame.
//     This waits for the face to stay gone (or back) before telling the app, so the screen doesn't flicker.
//   - headPose: an optional head-pose model (gaze.js) that corrects box picks when the head turns.
// Calibration settings (calibration, quadrant, blink) are read when the pipeline is built, so
// rebuild() applies them and recalibrates.

import { createGazeModel, featureVector, headPose, TARGETS } from './gaze.js';

// Every handler app.js must provide. Checked at startup, so a missing one fails loudly instead of
// throwing on every camera frame.
const HANDLERS = ['status', 'calibration', 'calibrated', 'hold', 'focus', 'select', 'blink', 'rest', 'face', 'fatigue'];

const medianPose = (poses) => {
  const med = (k) => {
    const s = poses.map((p) => p[k]).sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  return poses.length ? Object.fromEntries(['faceX', 'faceY', 'scale', 'yaw', 'pitch'].map((k) => [k, med(k)])) : null;
};

// Quadrants: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'; null = the middle band (the question), no box.
export async function startEyes(on, settings) {
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

  let pipeline = null;
  let gaze = null;
  let labels = null;           // head-model training looks, collected during calibration
  let faceState = true;        // what the app has been told
  let faceChange = null;       // { to, since } while a change is waiting out its debounce

  let selectMs = null; // set by the app per page (spelling is shorter); survives a rebuild

  function build() {
    pipeline = new EyePipeline({
      calibration: { layout: 'quadrants', ...settings.calibration },
      quadrant: { ...settings.quadrant },
      blink: { ...settings.blink, ...(selectMs ? { selectMs } : {}) },
    });
  }

  // Full recalibration: a fresh pipeline with the current settings, and a fresh head model.
  function reset() {
    build();
    gaze = createGazeModel();
    labels = { phase: null, since: 0, looks: {}, poses: [] };
  }

  // Starts the dots. Only on request (the Calibrate button, C, or the dev panel); never automatically.
  function rebuild() {
    reset();
    pipeline.startCalibration();
    status('Eyes: calibrating…');
  }

  function collectLabels(t, c, f, pose) {
    if (c.phase !== labels.phase) {
      labels.phase = c.phase;
      labels.since = t;
    }
    if (c.phase in TARGETS && f && t - labels.since >= settings.calibration.settleMs) {
      (labels.looks[c.phase] ??= []).push(f);
      if (pose) labels.poses.push(pose);
    }
  }

  function trainHeadModel() {
    for (const [target, vecs] of Object.entries(labels.looks)) gaze.add(vecs, target, 1);
    gaze.setBase(medianPose(labels.poses));
  }

  // The app gets "face lost" only after it has stayed lost for face.lostMs, and "found" after foundMs.
  function faceUpdate(t, found) {
    if (found === faceState) {
      faceChange = null;
      return;
    }
    if (!faceChange || faceChange.to !== found) faceChange = { to: found, since: t };
    const need = found ? settings.face.foundMs : settings.face.lostMs;
    if (t - faceChange.since >= need) {
      faceState = found;
      faceChange = null;
      on.face(found);
    }
  }

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
    const { frame, landmarks } = tracker.detect(video, performance.now());
    const t = frame.t;
    const pose = landmarks ? headPose(landmarks, video.videoWidth, video.videoHeight) : null;
    const f = featureVector(frame, pose);
    const out = pipeline.process(frame);
    faceUpdate(t, out.faceFound);

    if (out.mode === 'calibrating' && out.calibration) {
      collectLabels(t, out.calibration, f, pose);
      on.calibration(out.calibration.phase !== 'done' ? out.calibration : null);
    } else {
      on.calibration(null);
    }

    let focus = null;
    if (out.mode === 'running') {
      on.hold(out.blink ?? null);
      focus = out.quadrant?.focus ?? null;
      if (settings.headPose && gaze?.ready) focus = gaze.update(t, f, pose, !!out.blink?.engaged);
      on.focus(focus);
    }

    for (const e of out.events) {
      if (e.type === 'holdStart') {
        if (settings.headPose) gaze?.holdStart(e.t);
      } else if (e.type === 'quadrantSelect') {
        on.select(settings.headPose && gaze?.ready ? gaze.lockedFocus : e.quadrant);
      } else if (e.type === 'blink') on.blink(e.durationMs);
      else if (e.type === 'rest' || e.type === 'restEnd') on.rest(e.type === 'rest');
      else if (e.type === 'fatigue') on.fatigue(e.level);
      else if (e.type === 'calibrated') {
        if (settings.headPose) trainHeadModel();
        status(`Eyes: camera (${tracker.delegate}), calibrated${settings.headPose && gaze.ready ? ', head model on' : ''}`);
        if (e.result.warnings.length) console.warn('calibration:', e.result.warnings.join('; '));
        on.calibrated(e.result);
      } else if (e.type === 'calibrationFailed') {
        status(`Eyes: calibration failed (${e.reason}). Press C to retry.`);
      }
    }

    // For the dev panel's live readout and accuracy test. Not used by the patient screen.
    window.dispatchEvent(new CustomEvent('eyes-frame', {
      detail: { mode: out.mode, faceFound: out.faceFound, looking: out.quadrant?.looking ?? null, focus },
    }));
  };

  reset();
  status('Eyes: not calibrated. Press Calibrate.');
  video.requestVideoFrameCallback(loop);

  return {
    calibrate: rebuild,
    rebuild,
    // Hold time for a select, applied at once (the vision module reads it on every hold).
    setSelectMs(ms) {
      selectMs = ms;
      pipeline?.setBlinkConfig({ selectMs: ms });
    },
  };
}
