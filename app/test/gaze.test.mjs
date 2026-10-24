// Unit tests for renderer/gaze.js on synthetic looks: `npm test` (node --test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, createGazeModel, TARGETS } from '../renderer/gaze.js';

// A simulated patient. Eye-in-head features follow where they look minus how far the head is
// turned (turning toward a box means the eyes move less), plus a little noise.
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
function look([x, y], head = { yaw: 0, pitch: 0, dx: 0, dy: 0 }) {
  const ex = x - 0.8 * head.yaw;
  const ey = y - 0.8 * head.pitch;
  return [
    0.5 + 0.1 * ex + 0.004 * rand(),   // gazeX: iris between the corners
    0.1 + 0.06 * ey + 0.004 * rand(),  // gazeY: iris below the corner line
    0.6 * ex + 0.03 * rand(),          // lookX: eye-look score
    0.5 * ey + 0.03 * rand(),          // lookY
    head.yaw + 0.005 * rand(),         // yaw
    0.6 + head.pitch + 0.005 * rand(), // pitch
    0.5 + head.dx + 0.002 * rand(),    // faceX
    0.45 + head.dy + 0.002 * rand(),   // faceY
  ];
}
const boxes = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];
const samplesAt = (target, head, n = 40) => Array.from({ length: n }, () => look(TARGETS[target], head));

function calibrate(model, head) {
  for (const target of Object.keys(TARGETS)) model.add(samplesAt(target, head), target, 1);
}

// Share of looks at each box that land in that box (one fresh model state per look).
function accuracy(model, head) {
  let hits = 0;
  let total = 0;
  for (const target of boxes) {
    for (let i = 0; i < 20; i++) {
      const f = look(TARGETS[target], head);
      const pt = predictPoint(model, f);
      hits += classify(pt[0], pt[1]) === target ? 1 : 0;
      total++;
    }
  }
  return hits / total;
}
// Runs frames through update() until the focus settles, then reads the smoothed point.
function predictPoint(model, f) {
  let t = (predictPoint.t ??= 0);
  for (let i = 0; i < 12; i++) model.update((t += 33), f, null, false);
  predictPoint.t = t;
  return model.point;
}

test('picks the right box at the calibrated position', () => {
  const model = createGazeModel();
  calibrate(model, undefined);
  assert.ok(model.ready);
  assert.ok(accuracy(model) >= 0.95, `accuracy ${accuracy(model)}`);
});

test('a big head turn breaks it, and re-centering at the new position fixes it', () => {
  const model = createGazeModel();
  calibrate(model, undefined);
  const turned = { yaw: 1.0, pitch: 0.45, dx: 0.06, dy: 0.02 };
  const before = accuracy(model, turned);
  model.decay(0.6);
  calibrate(model, turned); // the quick re-center: center + each box at the new position
  const after = accuracy(model, turned);
  assert.ok(before < 0.8, `expected the turn to hurt, got ${before}`);
  assert.ok(after >= 0.95, `after re-centering ${after}`);
  // Both positions are now in the data, so the model learned how head pose shifts the eyes.
  assert.ok(accuracy(model) >= 0.9, `back at the first position ${accuracy(model)}`);
});

test('a pick uses the box looked at before the eyes closed, not the last frames', () => {
  const model = createGazeModel();
  calibrate(model, undefined);
  let t = 10_000;
  for (let i = 0; i < 25; i++) model.update((t += 33), look(TARGETS.topRight), null, false);
  // Closing lids drag the estimate down toward the bottom row for the last ~100 ms.
  for (let i = 0; i < 3; i++) model.update((t += 33), look([0.5, 0.6]), null, false);
  assert.equal(model.holdStart(t), 'topRight');
});

test('practice labels at a new position correct the model', () => {
  const model = createGazeModel();
  calibrate(model, undefined);
  const turned = { yaw: 1.0, pitch: 0.45, dx: 0.06, dy: 0.02 };
  const before = accuracy(model, turned);
  let t = 20_000;
  for (let round = 0; round < 3; round++) {
    for (const box of boxes) {
      // The patient looks at the marked box; whatever the model guessed, the label is the target.
      for (let i = 0; i < 25; i++) model.update((t += 33), look(TARGETS[box], turned), null, false);
      model.holdStart(t);
      model.labelLastHold(box, 2);
    }
  }
  const after = accuracy(model, turned);
  assert.ok(after > before + 0.2, `before ${before}, after ${after}`);
});

test('the center circle highlights nothing; an axis keeps its side near the middle', () => {
  assert.equal(classify(0.05, -0.1), null);
  assert.equal(classify(0.5, -0.5), 'topRight');
  assert.equal(classify(-0.04, 0.5, 'bottomRight'), 'bottomRight'); // inside hysteresis on x
  assert.equal(classify(-0.3, 0.5, 'bottomRight'), 'bottomLeft');
});

test('notices when the head or camera moves', () => {
  const model = createGazeModel();
  calibrate(model, undefined);
  const base = { faceX: 0.5, faceY: 0.45, scale: 0.12, yaw: 0, pitch: 0.6 };
  model.setBase(base);
  let t = 30_000;
  for (let i = 0; i < 10; i++) model.update((t += 33), null, { ...base, faceX: 0.62 }, false);
  assert.equal(model.moved, false, 'needs to stay moved for 2 s first');
  const realNow = performance.now;
  performance.now = () => realNow.call(performance) + 2500;
  assert.equal(model.moved, true);
  performance.now = realNow;
});
