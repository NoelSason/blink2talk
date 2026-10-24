// Camera eye input. The vision module (../vision, bundled into vendor/eyes.js by `npm run eyes`)
// runs MediaPipe's face model on this machine and does calibration, blink and squint holds, rests
// (eyes closed 3 s), face found/lost, and fatigue. Which box the patient is looking at comes from
// gaze.js, which adds head pose to the vision module's eye features and keeps correcting itself.
// app.js decides what each event does on screen. Without a camera or the bundle, the keyboard works.
//
// Calibration runs every launch: lighting, posture, and the laptop's position change between sessions.

import { createGazeModel, featureVector, headPose, TARGETS } from './gaze.js';

// Every handler app.js must provide. Checked at startup, so a missing one fails loudly instead of
// throwing on every camera frame.
const HANDLERS = ['status', 'calibration', 'calibrated', 'hold', 'focus', 'select', 'blink', 'rest', 'face', 'fatigue', 'gaze', 'moved', 'recentered'];

const SETTLE_MS = 450; // looks are ignored this long after a dot moves, while the eyes travel
// Quick re-center when the head or camera has moved: the center, then each box (about 6 s).
const RECENTER = [['center', 1600], ['topLeft', 1200], ['topRight', 1200], ['bottomRight', 1200], ['bottomLeft', 1200]];

// Session recording (main.js appends it to app/logs/): what the camera measured each frame and where
// the patient was meant to be looking (calibration, re-center, practice), for tuning gaze.js on real
// sessions. Numbers only, no images. Off in tests, where there is no preload.
const round = (v, k = 1e4) => (Number.isFinite(v) ? Math.round(v * k) / k : null);
let logLines = [];
const log = window.blink2talk?.gazeLog ? (entry) => logLines.push(JSON.stringify(entry)) : () => {};
if (window.blink2talk?.gazeLog) {
  setInterval(() => {
    if (!logLines.length) return;
    window.blink2talk.gazeLog(`${logLines.join('\n')}\n`);
    logLines = [];
  }, 1000);
}

const medianPose = (poses) => {
  const med = (k) => {
    const s = poses.map((p) => p[k]).sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  return poses.length ? Object.fromEntries(['faceX', 'faceY', 'scale', 'yaw', 'pitch'].map((k) => [k, med(k)])) : null;
};

// Quadrants: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'; null = the middle band (the question), no box.
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
  const gaze = createGazeModel();
  let calibration = null; // { phase, since, looks: { target: [vec] }, poses: [] } during the full calibration
  let recenter = null;    // { i, since, looks: [vec], poses: [] } during a quick re-center

  function beginCalibration() {
    recenter = null;
    gaze.reset(); // a full calibration starts the model fresh
    calibration = { phase: null, since: 0, looks: {}, poses: [] };
    pipeline.startCalibration();
    status('Eyes: calibrating…');
  }

  // The full calibration (vision module) runs the dots; the same frames, labeled by phase, train gaze.js.
  function collectCalibration(t, c, f, pose) {
    if (c.phase !== calibration.phase) {
      calibration.phase = c.phase;
      calibration.since = t;
    }
    if (c.phase in TARGETS && f && t - calibration.since >= SETTLE_MS) {
      (calibration.looks[c.phase] ??= []).push(f);
      if (pose) calibration.poses.push(pose);
    }
  }

  function finishCalibration(result) {
    for (const [target, vecs] of Object.entries(calibration.looks)) gaze.add(vecs, target, 1);
    gaze.setBase(medianPose(calibration.poses));
    calibration = null;
    status(`Eyes: camera (${tracker.delegate}), calibrated${gaze.ready ? ', head-aware' : ''}`);
    if (result.warnings.length) console.warn('calibration:', result.warnings.join('; '));
    on.calibrated(result);
  }

  function stepRecenter(t, f, pose) {
    const [target, ms] = RECENTER[recenter.i];
    const elapsed = t - recenter.since;
    on.calibration({ phase: target, progress: Math.min(1, elapsed / ms), remainingMs: Math.max(0, ms - elapsed) });
    if (elapsed >= SETTLE_MS && f) {
      recenter.looks.push(f);
      if (pose) recenter.poses.push(pose);
    }
    if (elapsed < ms) return;
    gaze.add(recenter.looks, target, 1.5);
    if (target === 'center') gaze.setBase(medianPose(recenter.poses));
    Object.assign(recenter, { i: recenter.i + 1, since: t, looks: [], poses: [] });
    if (recenter.i === RECENTER.length) {
      recenter = null;
      on.calibration(null);
      status(`Eyes: camera (${tracker.delegate}), re-centered`);
      on.recentered();
    }
  }

  log({ event: 'start', t: round(performance.now(), 10), screen: [innerWidth, innerHeight], video: [video.videoWidth, video.videoHeight], delegate: tracker.delegate });
  beginCalibration();
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

    if (out.mode === 'calibrating' && out.calibration && calibration) {
      collectCalibration(t, out.calibration, f, pose);
      on.calibration(out.calibration.phase !== 'done' ? out.calibration : null);
    } else if (recenter) {
      stepRecenter(t, f, pose);
    } else {
      on.calibration(null);
    }

    const looking = calibration?.phase ?? (recenter ? RECENTER[recenter.i]?.[0] : null);
    let focus = null;
    if (out.mode === 'running' && !recenter) {
      const hold = out.blink ?? null;
      on.hold(hold);
      // Before gaze.js has a model (calibration failed for it), fall back to the vision module's box.
      focus = gaze.ready ? gaze.update(t, f, pose, !!hold?.engaged) : out.quadrant?.focus ?? null;
      on.focus(focus);
      on.gaze(gaze.point);
      if (gaze.moved) on.moved();
    }
    log({
      t: round(t, 10),
      f: f ? f.map((v) => round(v)) : null,
      pose: pose ? [pose.faceX, pose.faceY, pose.scale, pose.yaw, pose.pitch].map((v) => round(v)) : null,
      ear: round(frame.ear),
      squint: round(frame.squint),
      looking,
      focus,
      visionFocus: out.quadrant?.focus ?? null, // the vision module's own guess, for comparison
      point: gaze.point ? gaze.point.map((v) => round(v)) : null,
      hold: out.blink?.engaged ? 1 : 0,
    });

    for (const e of out.events) {
      log({ t: round(e.t ?? t, 10), event: e.type, ms: round(e.durationMs, 10), box: e.type === 'select' ? gaze.lockedFocus : e.quadrant });
      if (e.type === 'holdStart') gaze.holdStart(e.t);
      // A pick is the box looked at most just before the eyes closed (gaze.js), or the vision module's.
      else if (e.type === 'select' && gaze.ready && !recenter) on.select(gaze.lockedFocus);
      else if (e.type === 'quadrantSelect' && !gaze.ready && !recenter) on.select(e.quadrant);
      else if (e.type === 'blink') on.blink(e.durationMs);
      else if (e.type === 'rest' || e.type === 'restEnd') on.rest(e.type === 'rest');
      else if (e.type === 'faceLost' || e.type === 'faceFound') on.face(e.type === 'faceFound');
      else if (e.type === 'fatigue') on.fatigue(e.level);
      else if (e.type === 'calibrated' && calibration) finishCalibration(e.result);
      else if (e.type === 'calibrationFailed') {
        calibration = null;
        status(`Eyes: calibration failed (${e.reason}). Press C to retry.`);
      }
    }
  };
  video.requestVideoFrameCallback(loop);

  return {
    calibrate: beginCalibration,
    recenter() {
      if (recenter || calibration || !gaze.ready) return;
      gaze.decay(0.6); // older looks count less; the new position counts more
      recenter = { i: 0, since: performance.now(), looks: [], poses: [] };
      status('Eyes: re-centering…');
    },
    // The app knows where the patient was really looking (a practice target, a confirmed answer).
    label(quadrant, weight) {
      log({ t: round(performance.now(), 10), event: 'label', box: quadrant, weight });
      gaze.labelLastHold(quadrant, weight);
    },
    // How far the eyes must move to reach a box: higher needs smaller looks (0.8 to 2).
    get sensitivity() { return gaze.sensitivity; },
    set sensitivity(v) {
      gaze.sensitivity = v;
      log({ t: round(performance.now(), 10), event: 'sensitivity', value: gaze.sensitivity });
    },
  };
}
