// Unit tests for renderer/drift.js: `npm test` (node --test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureDrift, shiftCenters } from '../renderer/drift.js';

const cal = () => ({
  dims: ['gazeX', 'gazeY'],
  centroids: { center: [0, 0], topLeft: [-1, -1], topRight: [1, -1], bottomLeft: [-1, 1], bottomRight: [1, 1] },
  scale: [0.5, 0.5],
});
const around = ([x, y], n = 20) => Array.from({ length: n }, (_, i) => [x + (i % 3 - 1) * 0.01, y + (i % 2) * 0.01]);

test('a uniform shift is measured and every center moves by it', () => {
  const c = cal();
  const d = measureDrift(c, { center: around([0.3, -0.2]), topLeft: around([-0.7, -1.2]), bottomRight: around([1.3, 0.8]) });
  assert.ok(Math.abs(d.offset[0] - 0.3) < 0.02 && Math.abs(d.offset[1] + 0.2) < 0.02);
  shiftCenters(c, d.offset);
  assert.ok(Math.abs(c.centroids.topRight[0] - 1.3) < 0.02, 'unchecked boxes move too');
  assert.ok(Math.abs(c.centroids.bottomLeft[1] - 0.8) < 0.02);
});

test('size is in units of calibration jitter', () => {
  const d = measureDrift(cal(), { center: around([1.5, 0]) });
  assert.ok(d.size > 2.9 && d.size < 3.1);
});

test('targets without enough looks are left out; none at all gives null', () => {
  assert.equal(measureDrift(cal(), { center: around([1, 1], 5) }), null);
  const d = measureDrift(cal(), { center: around([0.2, 0]), topLeft: around([5, 5], 3) });
  assert.deepEqual(Object.keys(d.perTarget), ['center']);
});
