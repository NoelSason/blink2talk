// Drift check math, kept apart from the camera loop so it can be tested (test/drift.test.mjs).
// `cal` is the vision module's QuadrantCalibration: { dims, centroids: { target: number[] }, scale: number[] }.
// `looks` maps a target to the feature vectors seen while the patient looked at it during the check.

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

// The average offset between where the eyes are now and where calibration put each checked target.
// Size is in units of normal look-to-look jitter (cal.scale): about 1 is small, 3 or more is a real shift.
// Null when no target had enough looks (the face wasn't seen).
export function measureDrift(cal, looks, minSamples = 10) {
  const offsets = [];
  const perTarget = {};
  for (const [target, vecs] of Object.entries(looks)) {
    if (!cal.centroids[target] || vecs.length < minSamples) continue;
    const off = cal.dims.map((_, i) => median(vecs.map((v) => v[i])) - cal.centroids[target][i]);
    offsets.push(off);
    perTarget[target] = Math.hypot(...off.map((o, i) => o / cal.scale[i]));
  }
  if (!offsets.length) return null;
  const offset = cal.dims.map((_, i) => offsets.reduce((a, o) => a + o[i], 0) / offsets.length);
  const size = Math.hypot(...offset.map((m, i) => m / cal.scale[i]));
  return { offset, size, perTarget };
}

// Moves every calibrated center (all five, not only the checked ones) by the offset, in place.
export function shiftCenters(cal, offset) {
  for (const c of Object.values(cal.centroids)) c.forEach((_, i) => { c[i] += offset[i]; });
}
