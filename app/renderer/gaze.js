// Gaze model on top of the vision module: where on the 2×2 grid the patient is looking.
//
// The vision module's own quadrant classifier uses eye-in-head features only (iris position between
// the eye corners, MediaPipe's eye-look scores), fit once at calibration. When the patient turns
// their head toward a box, or the head or camera moves afterwards, those features shift and it
// picks the wrong box. This model:
//   - adds head pose and face position, from the same landmarks, so a head turn isn't read as a look;
//   - maps features to a screen point with a ridge regression, refit whenever it learns where the
//     patient really looked (calibration);
//   - notices when the head or camera has moved away from where it was calibrated.
// Pure functions, no DOM. Optional: the dev panel's head-pose setting turns it on.

export const FEATURES = ['gazeX', 'gazeY', 'lookX', 'lookY', 'yaw', 'pitch', 'faceX', 'faceY'];
// A meaningful change per feature. Spreads are floored at these, so a feature that barely moved
// during calibration (head pose, usually) can't be scaled up into noise.
const FLOOR = [0.02, 0.02, 0.08, 0.08, 0.04, 0.04, 0.03, 0.03];

// Where each target sits on the gaze area (everything below the top bar), x and y in [-1, 1], +y down.
// The boxes sit in the corners and the question sits in the middle band between them, so targets are
// as far apart as the screen allows: a laptop at arm's length spans only a few degrees of eye movement.
// app.css (.reply-grid) lays the boxes out to match these centers.
export const TARGETS = {
  center: [0, 0],
  topLeft: [-0.9, -0.9],
  topRight: [0.9, -0.9],
  bottomLeft: [-0.9, 0.9],
  bottomRight: [0.9, 0.9],
};

const BAND = 0.28;          // |y| below this is the middle band (reading the question): no box
const HYSTERESIS = 0.06;    // an axis keeps its side until the estimate is this far past the boundary
const DWELL_MS = 150;       // a new box must hold this long before it takes the highlight
const LOCK_FROM_MS = 650;   // a pick uses the box looked at most in this window before the eyes closed,
const LOCK_TO_MS = 120;     // ignoring the last moments, when closing lids drag the estimate down
const MAX_SAMPLES = 4000;

// Head pose proxies from MediaPipe landmarks, in pixel-correct units (pass the video size).
// 33 / 263: outer eye corners; 1: nose tip.
export function headPose(lm, width, height) {
  const l = lm[33];
  const r = lm[263];
  const nose = lm[1];
  const ax = (r.x - l.x) * width;
  const ay = (r.y - l.y) * height;
  const eye = Math.hypot(ax, ay);
  if (!eye) return null;
  const ux = ax / eye;
  const uy = ay / eye;
  const dx = (nose.x - (l.x + r.x) / 2) * width;
  const dy = (nose.y - (l.y + r.y) / 2) * height;
  return {
    yaw: (dx * ux + dy * uy) / eye,   // nose along the eye line: turning left or right
    pitch: (dy * ux - dx * uy) / eye, // nose below the eye line: tilting up or down
    faceX: (l.x + r.x) / 2,
    faceY: (l.y + r.y) / 2,
    scale: eye / width,               // closer to the camera = larger
  };
}

export function featureVector(frame, pose) {
  if (!frame?.faceFound || !pose) return null;
  const v = [frame.gazeX, frame.gazeY, frame.lookX, frame.lookY, pose.yaw, pose.pitch, pose.faceX, pose.faceY];
  return v.every(Number.isFinite) ? v : null;
}

// Solves A x = b (small, dense) by Gaussian elimination with partial pivoting.
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) return null;
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

// Weighted ridge regression of x and y on standardized features (intercept not penalized).
export function fitModel(samples) {
  const W = samples.reduce((s, p) => s + p.w, 0);
  const targets = new Set(samples.map((p) => p.target));
  if (W === 0 || targets.size < 3) return null; // needs looks at several places to mean anything
  const d = FEATURES.length;
  const mean = FEATURES.map((_, j) => samples.reduce((s, p) => s + p.w * p.f[j], 0) / W);
  const spread = FEATURES.map((_, j) => Math.max(FLOOR[j], Math.sqrt(samples.reduce((s, p) => s + p.w * (p.f[j] - mean[j]) ** 2, 0) / W)));
  const lambda = 0.02 * W;
  const A = Array.from({ length: d + 1 }, () => new Array(d + 1).fill(0));
  const bx = new Array(d + 1).fill(0);
  const by = new Array(d + 1).fill(0);
  for (const p of samples) {
    const z = [...p.f.map((v, j) => (v - mean[j]) / spread[j]), 1];
    for (let i = 0; i <= d; i++) {
      bx[i] += p.w * z[i] * p.x;
      by[i] += p.w * z[i] * p.y;
      for (let k = 0; k <= d; k++) A[i][k] += p.w * z[i] * z[k];
    }
  }
  for (let i = 0; i < d; i++) A[i][i] += lambda;
  const cx = solve(A, bx);
  const cy = solve(A, by);
  return cx && cy ? { mean, spread, cx, cy } : null;
}

export function predict(model, f) {
  const z = [...f.map((v, j) => (v - model.mean[j]) / model.spread[j]), 1];
  const dot = (c) => c.reduce((s, ci, i) => s + ci * z[i], 0);
  const [gx, gy] = model.gain ?? [[1, 0], [1, 0]];
  return [gx[0] * dot(model.cx) + gx[1], gy[0] * dot(model.cy) + gy[1]];
}

// Screen point -> box ('topLeft' …), or null in the middle band where the question is. Leaving a box
// needs the estimate clearly inside the band, and switching columns needs it clearly past the middle.
export function classify(x, y, current = null) {
  if (Math.abs(y) < (current ? BAND - HYSTERESIS : BAND)) return null;
  const row = y < 0 ? 'top' : 'bottom';
  const currentCol = current ? (current.endsWith('Left') ? 'Left' : 'Right') : null;
  const col = currentCol && Math.abs(x) < HYSTERESIS ? currentCol : x < 0 ? 'Left' : 'Right';
  return row + col;
}

// One Euro filter (Casiez et al. 2012): smooth while the eyes rest, little lag when they move.
function oneEuro(minCutoff = 1.2, beta = 0.6, dCutoff = 1.0) {
  let prev = null;
  let dPrev = 0;
  let tPrev = 0;
  const alpha = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
  return (t, v) => {
    if (prev === null) {
      prev = v;
      tPrev = t;
      return v;
    }
    const dt = Math.max(1e-3, (t - tPrev) / 1000);
    tPrev = t;
    const d = (v - prev) / dt;
    dPrev += alpha(dCutoff, dt) * (d - dPrev);
    prev += alpha(minCutoff + beta * Math.abs(dPrev), dt) * (v - prev);
    return prev;
  };
}

// Ridge regression pulls estimates toward the middle. Rescale each axis so the average estimate for
// each calibration target lands on that target.
function stretch(model, samples) {
  const byTarget = new Map();
  for (const p of samples) {
    const [px, py] = predict(model, p.f);
    const e = byTarget.get(p.target) ?? { x: 0, y: 0, px: 0, py: 0, w: 0 };
    e.x = p.x;
    e.y = p.y;
    e.px += p.w * px;
    e.py += p.w * py;
    e.w += p.w;
    byTarget.set(p.target, e);
  }
  const axis = (k, pk) => {
    const pts = [...byTarget.values()].filter((e) => e.w > 0).map((e) => [e[pk] / e.w, e[k]]);
    const mp = pts.reduce((s, [p]) => s + p, 0) / pts.length;
    const mt = pts.reduce((s, [, t]) => s + t, 0) / pts.length;
    const cov = pts.reduce((s, [p, t]) => s + (p - mp) * (t - mt), 0);
    const varp = pts.reduce((s, [p]) => s + (p - mp) ** 2, 0);
    const a = varp > 1e-9 ? Math.min(3, Math.max(0.5, cov / varp)) : 1;
    return [a, mt - a * mp];
  };
  model.gain = [axis('x', 'px'), axis('y', 'py')];
  return model;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

// Has the head or camera moved away from where the model was last calibrated?
function poseShift(base, now) {
  return Math.max(
    Math.abs(now.faceX - base.faceX) / 0.07,
    Math.abs(now.faceY - base.faceY) / 0.07,
    Math.abs(Math.log(now.scale / base.scale)) / 0.18,
    Math.abs(now.yaw - base.yaw) / 0.12,
    Math.abs(now.pitch - base.pitch) / 0.12,
  ); // 1 = moved
}

export function createGazeModel() {
  let samples = [];
  let model = null;
  let base = null;           // head pose when last calibrated
  let poses = [];            // recent { t, pose }
  let movedSince = null;
  let point = null;          // smoothed [x, y]
  let filters = [oneEuro(), oneEuro()];
  let sensitivity = 1.2;     // >1 needs smaller looks; [ and ] change it
  let focus = null;
  let candidate = null;
  let candidateSince = 0;
  let history = [];          // recent { t, focus, f }
  let lastHold = null;       // { focus, vecs } captured when a hold started

  return {
    get ready() { return !!model; },
    get point() { return point; },
    get focus() { return focus; },
    get sensitivity() { return sensitivity; },
    set sensitivity(v) { sensitivity = Math.min(2, Math.max(0.8, v)); },

    reset() {
      samples = [];
      model = null;
      base = null;
      movedSince = null;
      point = focus = candidate = lastHold = null;
      filters = [oneEuro(), oneEuro()];
      history = [];
    },
    // Older looks count less, e.g. before re-centering at a new head or camera position.
    decay(factor) {
      for (const s of samples) s.w *= factor;
    },

    // Labeled looks: `target` is a TARGETS key. Calibration and re-centering pass whole phases.
    add(vecs, target, weight) {
      const [x, y] = TARGETS[target];
      for (const f of vecs) samples.push({ f, x, y, w: weight, target });
      if (samples.length > MAX_SAMPLES) samples = samples.slice(samples.length - MAX_SAMPLES);
      const next = fitModel(samples);
      if (next) model = stretch(next, samples);
    },
    // Teaches the model that the look before the last hold was really at `target`.
    labelLastHold(target, weight) {
      if (lastHold?.vecs.length) this.add(lastHold.vecs, target, weight);
    },
    setBase(pose) {
      base = pose;
      movedSince = null;
    },
    get moved() { return movedSince !== null && performance.now() - movedSince > 2000; },

    // One camera frame. `engaged`: a hold is in progress, so the estimate freezes (the lids drag it).
    update(t, f, pose, engaged) {
      if (pose) {
        poses.push({ t, pose });
        while (poses.length && t - poses[0].t > 1000) poses.shift();
        if (base && !engaged && poses.length > 5) {
          const now = Object.fromEntries(['faceX', 'faceY', 'scale', 'yaw', 'pitch'].map((k) => [k, median(poses.map((p) => p.pose[k]))]));
          if (poseShift(base, now) >= 1) movedSince ??= performance.now();
          else movedSince = null;
        }
      }
      if (!model || !f || engaged) return focus;
      const [x, y] = predict(model, f);
      point = [filters[0](t, x * sensitivity), filters[1](t, y * sensitivity)];
      const next = classify(point[0], point[1], focus);
      if (next !== candidate) {
        candidate = next;
        candidateSince = t;
      }
      if (candidate !== focus && t - candidateSince >= DWELL_MS) focus = candidate;
      history.push({ t, focus, f });
      while (history.length && t - history[0].t > 1500) history.shift();
      return focus;
    },

    // A hold started at time t: lock the box looked at most just before, and keep those looks.
    holdStart(t) {
      const window = history.filter((h) => h.t >= t - LOCK_FROM_MS && h.t <= t - LOCK_TO_MS);
      const counts = new Map();
      for (const h of window) counts.set(h.focus, (counts.get(h.focus) ?? 0) + 1);
      let best = focus;
      let most = 0;
      for (const [k, n] of counts) if (n > most) [best, most] = [k, n];
      lastHold = { focus: best, vecs: window.map((h) => h.f) };
      return best;
    },
    get lockedFocus() { return lastHold?.focus ?? null; },
  };
}
