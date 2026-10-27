// Box sounds: each box has its own pitch (F0), so a patient can hear which box is lit and, with
// their eyes closed for the pick, which one they chose. Higher on screen sounds higher, and right
// sounds higher than left, like a piano. The notes are a G major 7 chord (G4 B4 D5 F#5): a third
// apart, so no two are close, and no octave, so no two sound like the same note.
export const BOX_NOTES = [392.0, 493.88, 587.33, 739.99]; // Hz, low to high

// Low-to-high position of each cell (reading order: top left, top right, bottom left, bottom right).
const GRID_POSITION = [2, 3, 0, 1];

// The note for a cell, or null when it has none.
//   layout 'grid': the 2x2. 'row': four bars side by side, cells left to right in rowOrder.
//   'two': the two tall boxes of the confirm screens, left (cell 0) and right (cell 1); the lowest and
//   highest notes, so the pair is as far apart as the four allow.
export function boxNote(cell, layout = 'grid', rowOrder = []) {
  if (!Number.isInteger(cell) || cell < 0) return null;
  const position = layout === 'two' ? [0, 3][cell] : layout === 'row' ? rowOrder.indexOf(cell) : GRID_POSITION[cell];
  return BOX_NOTES[position] ?? null;
}
