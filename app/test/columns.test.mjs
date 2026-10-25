import test from 'node:test';
import assert from 'node:assert/strict';
import { createColumnPicker, COLUMN_BOX } from '../renderer/columns.js';

const run = (picker, x, from, ms = 600) => {
  for (let t = from; t <= from + ms; t += 33) picker.update(t, x);
  return picker.focus;
};

test('each quarter of the row is its own column', () => {
  for (const [x, col] of [[-0.9, 0], [-0.3, 1], [0.3, 2], [0.9, 3]]) {
    assert.equal(run(createColumnPicker({ reach: 1 }), x, 0), col, `x=${x}`);
  }
});

test('a new column needs the dwell before it takes the focus', () => {
  const p = createColumnPicker({ reach: 1, focusMs: 300 });
  run(p, -0.9, 0);
  for (let t = 700; t < 900; t += 33) p.update(t, 0.9);
  assert.equal(p.focus, 0);
  run(p, 0.9, 900);
  assert.equal(p.focus, 3);
});

test('small wobble across a border keeps the column', () => {
  const p = createColumnPicker({ reach: 1, margin: 0.08, frames: 1 });
  run(p, -0.55, 0); // column 1 starts at -0.5... this is column 0
  assert.equal(p.focus, 0);
  run(p, -0.47, 700); // 0.03 past the border: inside the margin
  assert.equal(p.focus, 0);
  run(p, -0.3, 1400); // well past it
  assert.equal(p.focus, 1);
});

test('missing readings change nothing', () => {
  const p = createColumnPicker({ reach: 1 });
  run(p, 0.9, 0);
  p.update(700, NaN);
  assert.equal(p.focus, 3);
});

test('left two columns are the Left boxes, right two the Right boxes', () => {
  assert.deepEqual(COLUMN_BOX.map((b) => b.endsWith('Left')), [true, true, false, false]);
});
