// Camera eye input. The vision module (../vision, bundled into vendor/eyes.js by `npm run eyes`)
// runs MediaPipe's face model and owns calibration, box picking, blink and squint holds, rest, and
// fatigue. Three things here are dev-mode switches (devpanel.js), read live from `settings`:
//   - face.lostMs / face.foundMs: the vision module reports "face lost" on every dropped frame.
//     This waits for the face to stay gone (or back) before telling the app, so the screen doesn't flicker.
//   - headPose: an optional head-pose model (gaze.js) that corrects box picks when the head turns.
// Calibration settings (calibration, quadrant, blink) are read when the pipeline is built, so
// rebuild() applies them and recalibrates.

import { createGazeModel, featureVector, headPose, TARGETS } from './gaze.js';
import { measureDrift, shiftCenters } from './drift.js';

// Every handler app.js must provide. Checked at startup, so a missing one fails loudly instead of
// throwing on every camera frame.
const HANDLERS = ['status', 'calibration', 'calibrated', 'hold', 'focus', 'select', 'blink', 'rest', 'face', 'fatigue'];

// Drift check: the center, then two opposite corners, about 8 s. Measures how far the eye readings
// have moved since calibration and shifts all five calibrated box centers by the average offset.
// It fixes sliding (head settling, camera nudged); a full calibration still fixes everything else.
const DRIFT_STEPS = [['center', 2600], ['topLeft', 2700], ['bottomRight', 2700]];
const DRIFT_SETTLE_MS = 600;  // ignored at the start of each dot while the eyes travel
const DRIFT_MIN_SAMPLES = 10; // a dot with fewer usable frames (face not seen) is left out

// Feature log: every 3rd camera frame (about 10 a second) to app/logs/, numbers only, no images.
// Each line has the eye measurements and, when known, where the patient was meant to be looking.
const LOG_EVERY = 3;
const r = (v, k = 1e4) => (Number.isFinite(v) ? Math.round(v * k) / k : null);
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
  const { EyePipeline, FaceTracker, openWebcam, featureVector: visionFeatures } = vision;
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
  let drift = null;            // { i, since, vecs, heads } while a drift check runs
  let label = null;            // where the dev panel's accuracy test asked the patient to look
  let frameNo = 0;

  const logOn = typeof window.blink2talk?.eyesLog === 'function'; // off in tests (no preload)
  let logLines = [];
  const log = (entry) => { if (logOn) logLines.push(JSON.stringify(entry)); };
  if (logOn) {
    setInterval(() => {
      if (!logLines.length) return;
      window.blink2talk.eyesLog(`${logLines.join('\n')}\n`);
      logLines = [];
    }, 1000);
  }
  window.addEventListener('eyes-label', (e) => {
    label = e.detail?.label ?? null;
    log({ t: r(performance.now(), 10), event: 'label', label });
  });
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

  function startDrift() {
    if (drift || pipeline?.mode !== 'running' || !pipeline.calibration?.quadrants) return false;
    drift = { i: 0, since: null, vecs: {}, heads: {} };
    status('Eyes: drift check…');
    return true;
  }

  function stepDrift(t, frame, f) {
    const [target, ms] = DRIFT_STEPS[drift.i];
    drift.since ??= t;
    const elapsed = t - drift.since;
    on.calibration({ phase: target, progress: Math.min(1, elapsed / ms), remainingMs: Math.max(0, ms - elapsed) });
    if (elapsed >= DRIFT_SETTLE_MS && frame.faceFound) {
      const v = visionFeatures(frame, pipeline.calibration.quadrants.dims);
      if (v.every(Number.isFinite)) (drift.vecs[target] ??= []).push(v);
      if (f) (drift.heads[target] ??= []).push(f);
    }
    if (elapsed < ms) return;
    drift.i++;
    drift.since = t;
    if (drift.i === DRIFT_STEPS.length) finishDrift(t);
  }

  function finishDrift(t) {
    const cal = pipeline.calibration.quadrants;
    const { vecs, heads } = drift;
    drift = null;
    on.calibration(null);
    const d = measureDrift(cal, vecs, DRIFT_MIN_SAMPLES);
    if (!d) {
      status("Eyes: drift check failed (face not seen). Try again or recalibrate.");
      return;
    }
    // In place: the box classifier holds this same object, so blink and fatigue tracking keep going.
    shiftCenters(cal, d.offset);
    if (settings.headPose && gaze?.ready) {
      gaze.decay(0.6); // older looks count less; the new position counts more
      for (const [target, looks] of Object.entries(heads)) gaze.add(looks, target, 1.5);
    }
    status(`Eyes: drift check done (moved ${d.size.toFixed(1)})`);
    log({ t: r(t, 10), event: 'drift', dims: cal.dims, offset: d.offset.map((v) => r(v)), size: r(d.size, 100), perTarget: d.perTarget });
    window.dispatchEvent(new CustomEvent('eyes-drift', { detail: { size: d.size, perTarget: d.perTarget } }));
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

    if (drift) stepDrift(t, frame, f);
    else if (out.mode === 'calibrating' && out.calibration) {
      collectLabels(t, out.calibration, f, pose);
      on.calibration(out.calibration.phase !== 'done' ? out.calibration : null);
    } else {
      on.calibration(null);
    }

    let focus = null;
    if (out.mode === 'running' && !drift) {
      on.hold(out.blink ?? null);
      focus = out.quadrant?.focus ?? null;
      if (settings.headPose && gaze?.ready) focus = gaze.update(t, f, pose, !!out.blink?.engaged);
      on.focus(focus);
    }

    for (const e of out.events) {
      if (e.type === 'holdStart') {
        if (settings.headPose) gaze?.holdStart(e.t);
      } else if (e.type === 'quadrantSelect') {
        log({ t: r(e.t, 10), event: 'select', box: e.quadrant, via: e.via });
        if (!drift) on.select(settings.headPose && gaze?.ready ? gaze.lockedFocus : e.quadrant);
      } else if (e.type === 'blink') {
        log({ t: r(e.t, 10), event: 'blink', ms: r(e.durationMs, 1) });
        if (!drift) on.blink(e.durationMs);
      }
      else if (e.type === 'rest' || e.type === 'restEnd') on.rest(e.type === 'rest');
      else if (e.type === 'fatigue') on.fatigue(e.level);
      else if (e.type === 'calibrated') {
        if (settings.headPose) trainHeadModel();
        const q = e.result.quadrants;
        log({ t: r(e.t, 10), event: 'calibrated', dims: q?.dims, centroids: q?.centroids, scale: q?.scale, accuracy: q?.accuracy, warnings: e.result.warnings, settings });
        status(`Eyes: camera (${tracker.delegate}), calibrated${settings.headPose && gaze.ready ? ', head model on' : ''}`);
        if (e.result.warnings.length) console.warn('calibration:', e.result.warnings.join('; '));
        on.calibrated(e.result);
      } else if (e.type === 'calibrationFailed') {
        status(`Eyes: calibration failed (${e.reason}). Press C to retry.`);
      }
    }

    if (logOn && frameNo++ % LOG_EVERY === 0) {
      log({
        t: r(t, 10),
        mode: out.mode,
        face: out.faceFound ? 1 : 0,
        f: ['gazeX', 'gazeY', 'lookX', 'lookY'].map((k) => r(frame[k])),
        ear: r(frame.ear),
        squint: r(frame.squint),
        pose: pose ? [pose.yaw, pose.pitch, pose.scale].map((v) => r(v)) : null,
        looking: out.quadrant?.looking ?? null,
        focus,
        target: drift ? `drift:${DRIFT_STEPS[drift.i]?.[0]}` : out.mode === 'calibrating' ? `cal:${out.calibration?.phase}` : label,
      });
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
    driftCheck: startDrift,
    // Hold time for a select, applied at once (the vision module reads it on every hold).
    setSelectMs(ms) {
      selectMs = ms;
      pipeline?.setBlinkConfig({ selectMs: ms });
    },
  };
}
