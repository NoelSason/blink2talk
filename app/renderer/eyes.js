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
import { AxisPicker, startWebEyeTrack, toArea } from './webeyetrack.js';

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
  // WebEyeTrack gaze source (dev setting). wet: the tracker; wetPoint: its last point in area units;
  // wetArmed: the box it had in focus when a hold began, so the pick matches what was highlighted.
  let wet = null;
  let wetPoint = null;
  let wetPicker = null;
  let wetArmed = null;
  let wetLabeledPhase = null;
  const gazeArea = () => document.getElementById('gaze-area')?.getBoundingClientRect();
  async function startWet() {
    if (wet || settings.gazeSource !== 'webeyetrack') return;
    wetPicker = new AxisPicker({ ...settings.quadrant });
    try {
      wet = await startWebEyeTrack(video, (nx, ny, open, t) => {
        const area = gazeArea();
        if (!area?.width) return;
        const [ax, ay] = toArea(nx, ny, area);
        wetPoint = { ax, ay, open, t };
        window.dispatchEvent(new CustomEvent('eyes-point', { detail: { x: ax, y: ay } })); // dev panel dot
      });
      status('Eyes: WebEyeTrack loading…');
    } catch (err) {
      status(`Eyes: WebEyeTrack failed (${err?.message ?? err}); using the vision module`);
      settings.gazeSource = 'vision';
    }
  }
  function stopWet() {
    wet?.stop();
    wet = null;
    wetPoint = null;
    wetPicker = null;
  }
  // Teach WebEyeTrack where the eyes are: the calibration dot, or a box's corner mark after a confirmed pick.
  function wetLabelAt(el, corner) {
    if (!wet || !el) return;
    const b = el.getBoundingClientRect();
    const inset = 17; // the corner mark's center (app.css): 10 px in, 14 px wide
    const x = corner ? (corner.endsWith('Right') ? b.right - inset : b.left + inset) : b.left + b.width / 2;
    const y = corner ? (corner.startsWith('bottom') ? b.bottom - inset : b.top + inset) : b.top + b.height / 2;
    wet.label(x, y);
    log({ t: r(performance.now(), 10), event: 'wetLabel', corner: corner ?? 'dot', x: r(x / window.innerWidth - 0.5), y: r(y / window.innerHeight - 0.5) });
  }
  const CELL = { topLeft: 1, topRight: 2, bottomLeft: 3, bottomRight: 4 };


  function build() {
    pipeline = new EyePipeline({
      calibration: { layout: 'quadrants', ...settings.calibration },
      quadrant: { ...settings.quadrant },
      blink: { ...settings.blink },
    });
  }

  // Full recalibration: a fresh pipeline with the current settings, and a fresh head model.
  function reset() {
    build();
    gaze = createGazeModel();
    labels = { phase: null, since: 0, looks: {}, poses: [] };
  }

  // Starts the dots: on every launch (lighting, posture, and the laptop's position change between
  // sessions, and nothing can be picked until it's done), and on request (the Calibrate button, C,
  // three quick blinks, or the dev panel).
  function rebuild() {
    blinkLevels = null;
    reset();
    wetLabeledPhase = null;
    if (settings.gazeSource === 'webeyetrack') startWet();
    else stopWet();
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

  // Quick blinks, counted from each frame's eye openness (EAR) instead of the vision module's blink
  // events: it smooths EAR over 3 frames, so two fast blinks merged into one and a fast double blink
  // didn't count. A blink here is EAR under the calibrated closed level for 2+ frames, then over the
  // calibrated open level for 2+ frames. Needing 2 frames each way keeps camera noise from turning
  // one blink into several (a first version counted single frames, and ordinary blinks added up to
  // "three blinks"). Quiet for a moment after a pick, so lids settling after a choice don't count.
  const QUICK_BLINK_MS = 500;
  let blinkLevels = null;  // { close, open }, set by calibration
  let closedSince = null;  // first frame under `close` in the current run
  let closedFrames = 0;
  let openFrames = 0;
  let blinkStart = null;   // a closure that has lasted 2+ frames
  let blinkQuietUntil = 0;
  function countBlink(t, ear) {
    if (!blinkLevels || !Number.isFinite(ear)) {
      closedSince = blinkStart = null;
      closedFrames = openFrames = 0;
      return;
    }
    if (ear < blinkLevels.close) {
      openFrames = 0;
      if (closedFrames++ === 0) closedSince = t;
      if (closedFrames >= 2) blinkStart ??= closedSince;
    } else {
      closedFrames = 0;
      if (ear > blinkLevels.open && blinkStart !== null && ++openFrames >= 2) {
        // Only quick ones: a closure of QUICK_BLINK_MS or more may be a pick (600 ms on the spelling page).
        if (t >= blinkQuietUntil && t - blinkStart < QUICK_BLINK_MS) {
          log({ t: r(t, 10), event: 'quickBlink', ms: r(t - blinkStart, 1) });
          on.blink(t - blinkStart);
        }
        blinkStart = null;
        openFrames = 0;
      }
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
      const c = out.calibration;
      if (wet && c.phase in TARGETS && c.remainingMs < 400 && wetLabeledPhase !== c.phase) {
        wetLabeledPhase = c.phase;
        wetLabelAt(document.getElementById('calib-dot'));
      }
      on.calibration(c.phase !== 'done' ? c : null);
    } else {
      on.calibration(null);
    }

    let focus = null;
    if (out.mode === 'running' && !drift) {
      countBlink(t, frame.ear);
      on.hold(out.blink ?? null);
      focus = out.quadrant?.focus ?? null;
      if (settings.headPose && gaze?.ready) focus = gaze.update(t, f, pose, !!out.blink?.engaged);
      // WebEyeTrack: its point drives the box while the eyes are open; a hold freezes it (lids drag the point).
      if (wet && wetPicker && wetPoint && !out.blink?.engaged && wetPoint.open) focus = wetPicker.update(t, wetPoint.ax, wetPoint.ay);
      else if (wet && wetPicker) focus = wetPicker.focus;
      on.focus(focus);
    }

    for (const e of out.events) {
      if (e.type === 'holdStart') {
        if (settings.headPose) gaze?.holdStart(e.t);
        wetArmed = wetPicker?.focus ?? null;
      } else if (e.type === 'quadrantSelect') {
        const box = wet && wetPicker ? wetArmed : settings.headPose && gaze?.ready ? gaze.lockedFocus : e.quadrant;
        log({ t: r(e.t, 10), event: 'select', box, via: e.via, source: wet ? 'webeyetrack' : 'vision' });
        blinkQuietUntil = e.t + 1000;
        if (!drift) on.select(box, wet ? null : e.look);
      } else if (e.type === 'blink') {
        // Logged only: quick blinks reach the app from countBlink, which doesn't merge fast ones.
        log({ t: r(e.t, 10), event: 'blink', ms: r(e.durationMs, 1) });
      }
      else if (e.type === 'rest' || e.type === 'restEnd') on.rest(e.type === 'rest');
      else if (e.type === 'fatigue') on.fatigue(e.level);
      else if (e.type === 'calibrated') {
        blinkLevels = { ...e.result.thresholds }; // the vision module's closed and open levels
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
      detail: { mode: out.mode, faceFound: out.faceFound, looking: wet && wetPicker ? wetPicker.looking : out.quadrant?.looking ?? null, focus, source: wet ? 'webeyetrack' : 'vision' },
    }));
  };

  rebuild();
  video.requestVideoFrameCallback(loop);

  return {
    calibrate: rebuild,
    rebuild,
    driftCheck: startDrift,
    // Blink settings applied at once (the vision module reads them on every hold). The same values
    // are in `settings`, so a rebuild keeps them.
    setBlink(patch) {
      pipeline?.setBlinkConfig(patch);
    },
    // A pick that was spoken and not undone: teach the box classifier where the eyes were for that box.
    learn(quadrant, look) {
      if (!quadrant) return;
      if (wet) wetLabelAt(document.querySelector(`.reply-grid > :nth-child(${CELL[quadrant]})`), quadrant);
      else if (look) pipeline?.learn(quadrant, look);
    },
  };
}
