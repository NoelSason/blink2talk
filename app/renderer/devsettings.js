// Dev-mode settings: the eye tracker's tunable values, saved in this browser so a reload keeps them.
// devpanel.js edits them; eyes.js reads them. Defaults match vision/src/cv/*.ts (the vision module's own
// defaults), except face, which the app owns.

export const SETTINGS_KEY = 'blink2talk.dev';

export const DEFAULTS = {
  calibration: { readyMs: 3000, leadMs: 2000, phaseMs: 3000, settleMs: 500 },
  quadrant: { focusMs: 300, margin: 0.15, dead: 0.3, smoothingFrames: 5 },
  blink: { selectMs: 800, refractoryMs: 1200, smoothingFrames: 3 },
  face: { lostMs: 500, foundMs: 150 },
  headPose: false,
  learnFromPicks: false,  // a spoken, not-undone pick teaches the box classifier where the eyes were. Off: a wrong pick that isn't undone teaches the wrong box
  layout: 'kahoot',     // 'kahoot' (question on top, 2x2 below it) | 'row' (4 tall boxes side by side, left-right eye movement only) | 'spread' (2x2 in the corners, question between)
  dots: 'corners',      // calibration dots: 'corners' (outer corner of each box) | 'centers' (middle of each box)
  gazeCircle: false,    // a soft circle follows where the tracker thinks the eyes are (like Beam's gaze bubble); dev mode turns it on
};

// Calibration dot positions on the gaze area (x and y in [-1, 1], +y down). Corners: each box's outer
// corner, the biggest eye movement the screen allows. Centers: the middle of each box (0.5 of the grid
// in the Kahoot layout, where the dots are placed on the grid itself; about 0.6 of the area in spread). The vision module's classifier only compares eye features between dots, so either works
// with it; the view and the head model use these numbers.
export const DOT_POSITIONS = {
  corners: { center: [0, 0], topLeft: [-0.9, -0.9], topRight: [0.9, -0.9], bottomLeft: [-0.9, 0.9], bottomRight: [0.9, 0.9] },
  centers: { center: [0, 0], topLeft: [-0.6, -0.6], topRight: [0.6, -0.6], bottomLeft: [-0.6, 0.6], bottomRight: [0.6, 0.6] },
  kahootCenters: { center: [0, 0], topLeft: [-0.5, -0.5], topRight: [0.5, -0.5], bottomLeft: [-0.5, 0.5], bottomRight: [0.5, 0.5] },
};
export const dotPositions = (dots, layout = 'kahoot') =>
  dots === 'centers' ? (layout === 'spread' ? DOT_POSITIONS.centers : DOT_POSITIONS.kahootCenters) : DOT_POSITIONS.corners;

export function loadSettings() {
  const out = structuredClone(DEFAULTS);
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    if (!saved) return out;
    for (const group of Object.keys(out)) {
      if (typeof out[group] === 'object') Object.assign(out[group], saved[group] ?? {});
      else if (typeof saved[group] === typeof out[group]) out[group] = saved[group];
    }
  } catch {
    // Unreadable or blocked storage: run with the defaults.
  }
  return out;
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Not saved; the values still apply for this session.
  }
}
