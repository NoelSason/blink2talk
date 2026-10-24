// Dev-mode settings: the eye tracker's tunable values, saved in this browser so a reload keeps them.
// devpanel.js edits them; eyes.js reads them. Defaults match vision/src/cv/*.ts (the vision module's own
// defaults), except face, which the app owns.

export const SETTINGS_KEY = 'blink2talk.dev';

export const DEFAULTS = {
  calibration: { readyMs: 3000, phaseMs: 2000, settleMs: 500 },
  quadrant: { focusMs: 300, margin: 0.5, smoothingFrames: 5 },
  blink: { selectMs: 800, refractoryMs: 1200, smoothingFrames: 3 },
  face: { lostMs: 500, foundMs: 150 },
  headPose: false,
};

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
