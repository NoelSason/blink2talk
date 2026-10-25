// Row layout: four tall boxes side by side, so only left-right eye movement counts. Up-down is the
// weak axis on a webcam (it drifts with the eyelids), so this picker never looks at it.
//
// Input: the vision module's horizontal position (axisPosition(cal, vec, 'x')): 0 at the calibrated
// center, ±1 at the calibrated left and right dots. `reach` is where those dots sit on the row
// (0.9 = near the outer edges), so x * reach is a point on the row in [-1, 1], and the four columns
// are its quarters. An axis keeps its column until the point is `margin` past the border (hysteresis),
// and a new column takes the focus only after `focusMs` of looking at it.

export function createColumnPicker({ focusMs = 300, margin = 0.08, frames = 5, reach = 0.9 } = {}) {
  let recent = [];
  let looking = null; // column the eyes are on now
  let focus = null;   // column with the highlight (looking, after the dwell)
  let since = 0;

  const columnAt = (p) => Math.max(0, Math.min(3, Math.floor((p + 1) * 2)));

  return {
    get focus() { return focus; },
    get looking() { return looking; },
    reset() {
      recent = [];
      looking = focus = null;
    },
    update(t, x) {
      if (!Number.isFinite(x)) return focus;
      recent.push(x);
      if (recent.length > frames) recent.shift();
      const sorted = [...recent].sort((a, b) => a - b);
      const p = sorted[Math.floor(sorted.length / 2)] * reach;
      let next = columnAt(p);
      if (looking !== null && next !== looking) {
        // Borders of the current column, in row units: -1 + 0.5 * column ... -1 + 0.5 * (column + 1).
        const left = -1 + 0.5 * looking;
        const right = left + 0.5;
        if (p > left - margin && p < right + margin) next = looking;
      }
      if (next !== looking) {
        looking = next;
        since = t;
      }
      if (looking !== focus && t - since >= focusMs) focus = looking;
      return focus;
    },
  };
}

// Column (left to right) -> the box name the app uses. The row shows the boxes in the order
// 1, 3, 2, 4 (app.css), so the left two are the "Left" boxes and the right two the "Right" boxes,
// and the two-box confirm screens (left half / right half) still work unchanged.
export const COLUMN_BOX = ['topLeft', 'bottomLeft', 'topRight', 'bottomRight'];
