import test from 'node:test';
import assert from 'node:assert/strict';
import { BOX_NOTES, boxNote } from '../renderer/pitch.js';
import { COLUMN_BOX } from '../renderer/columns.js';

const GRID = { topLeft: 0, topRight: 1, bottomLeft: 2, bottomRight: 3 };
const ROW_ORDER = COLUMN_BOX.map((box) => GRID[box]);

test('in the 2x2, the top boxes sound higher than the bottom ones, and right higher than left', () => {
  const [tl, tr, bl, br] = [0, 1, 2, 3].map((cell) => boxNote(cell));
  assert.ok(bl < br && br < tl && tl < tr, JSON.stringify({ tl, tr, bl, br }));
});

test('every box has its own note, and no two are an octave apart', () => {
  assert.equal(new Set(BOX_NOTES).size, 4);
  for (const a of BOX_NOTES) {
    for (const b of BOX_NOTES) {
      if (a < b) assert.ok(Math.abs(b / a - 2) > 0.05 && b / a > 1.15, `${a} and ${b}`);
    }
  }
});

test('in the row, the notes rise left to right as the bars are drawn', () => {
  const notes = ROW_ORDER.map((cell) => boxNote(cell, 'row', ROW_ORDER));
  assert.deepEqual(notes, BOX_NOTES);
});

test('the two-box confirm screens use the lowest and highest notes', () => {
  assert.equal(boxNote(0, 'two'), BOX_NOTES[0]);
  assert.equal(boxNote(1, 'two'), BOX_NOTES[3]);
});

test('no box, no note', () => {
  assert.equal(boxNote(-1), null);
  assert.equal(boxNote(4), null);
  assert.equal(boxNote(2, 'two'), null);
  assert.equal(boxNote(undefined), null);
});
