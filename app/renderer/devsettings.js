// Dev-mode settings: the eye tracker's tunable values, saved in this browser so a reload keeps them.
// devpanel.js edits them; eyes.js reads them. Defaults match vision/src/cv/*.ts (the vision module's own
// defaults), except face, which the app owns.

export const SETTINGS_KEY = 'blink2talk.dev';

export const DEFAULTS = {
  calibration: { readyMs: 3000, leadMs: 2000, phaseMs: 2000, settleMs: 500 },
  quadrant: { focusMs: 300, margin: 0.15, dead: 0.3, smoothingFrames: 5 },
  blink: { selectMs: 800, refractoryMs: 1200, smoothingFrames: 3 },
  face: { lostMs: 500, foundMs: 150 },
  headPose: false,
  learnFromPicks: false,  // a spoken, not-undone pick teaches the box classifier where the eyes were. Off: a wrong pick that isn't undone teaches the wrong box
  layout: 'kahoot',     // 2x2 screens: 'kahoot' (question on top, boxes together) | 'spread' (boxes in the corners, question between)
  dots: 'corners',      // calibration dots: 'corners' (outer corner of each box) | 'centers' (middle of each box)
  gazeSource: 'vision', // 'vision' (MediaPipe features + per-axis classifier) | 'webeyetrack' (neural gaze point)
};

// Calibration dot positions on the gaze area (x and y in [-1, 1], +y down). Corners: each box's outer
// corner, the biggest eye movement the screen allows. Centers: the middle of each box (about 0.6 on the
// 2x2 layout). The vision module's classifier only compares eye features between dots, so either works
// with it; the view, the head model and WebEyeTrack use these numbers.
export const DOT_POSITIONS = {
  corners: { center: [0, 0], topLeft: [-0.9, -0.9], topRight: [0.9, -0.9], bottomLeft: [-0.9, 0.9], bottomRight: [0.9, 0.9] },
  centers: { center: [0, 0], topLeft: [-0.6, -0.6], topRight: [0.6, -0.6], bottomLeft: [-0.6, 0.6], bottomRight: [0.6, 0.6] },
};
export const dotPositions = (dots) => DOT_POSITIONS[dots] ?? DOT_POSITIONS.corners;

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
