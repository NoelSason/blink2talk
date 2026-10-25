import { median, MedianFilter, robustSpread } from "./stats";
import type { EyeFrame } from "./types";

export const QUADRANTS = ["topLeft", "topRight", "bottomRight", "bottomLeft"] as const;
export type Quadrant = (typeof QUADRANTS)[number];
/** "center" is the rest circle where the boxes meet: looking there focuses nothing. */
export type QuadrantTarget = Quadrant | "center";
export const QUADRANT_TARGETS: readonly QuadrantTarget[] = ["center", ...QUADRANTS];

export const GAZE_FEATURES = ["gazeX", "gazeY", "lookX", "lookY"] as const;
export type GazeFeature = (typeof GAZE_FEATURES)[number];
/** Which screen axis each feature speaks to. The two axes are decided independently (see below). */
const AXIS_OF: Record<GazeFeature, "x" | "y"> = { gazeX: "x", lookX: "x", gazeY: "y", lookY: "y" };

/**
 * Calibration dot positions in normalized area coordinates (x and y in [-1, 1], +y down): the center
 * and the outer corner of each box of a 2×2 grid. Corner dots give the biggest eye movement the screen
 * allows; in use the patient glances toward a box's corner, and the boundaries still run through the middle.
 */
export const TARGET_POSITIONS: Record<QuadrantTarget, readonly [number, number]> = {
  center: [0, 0],
  topLeft: [-0.9, -0.9],
  topRight: [0.9, -0.9],
  bottomRight: [0.9, 0.9],
  bottomLeft: [-0.9, 0.9],
};

export function featureVector(frame: EyeFrame, dims: readonly GazeFeature[]): number[] {
  return dims.map((d) => frame[d]);
}

export interface QuadrantCalibration {
  dims: GazeFeature[];
  /** Per-target median feature vector. */
  centroids: Record<QuadrantTarget, number[]>;
  /** Pooled within-target spread per dimension; distances are measured in these units. */
  scale: number[];
  /** Share of each target's calibration samples that classify back to it. */
  accuracy: Record<QuadrantTarget, number>;
}

/**
 * Where `vec` sits along one axis: 0 at the center, +1 at the calibrated right (or bottom) side, -1 at
 * the left (or top). Only that axis's features count, each weighted by 1/spread, so a feature that
 * drifts on the other axis (vertical gaze sliding with the eyelids, the common case) can't flip this one.
 */
export function axisPosition(cal: QuadrantCalibration, vec: readonly number[], axis: "x" | "y"): number {
  const c = cal.centroids;
  const pos = axis === "x" ? (["topRight", "bottomRight"] as const) : (["bottomLeft", "bottomRight"] as const);
  const neg = axis === "x" ? (["topLeft", "bottomLeft"] as const) : (["topLeft", "topRight"] as const);
  let num = 0;
  let den = 0;
  cal.dims.forEach((d, i) => {
    if (AXIS_OF[d] !== axis) return;
    const half = ((c[pos[0]][i] + c[pos[1]][i]) / 2 - (c[neg[0]][i] + c[neg[1]][i]) / 2) / 2;
    const mid = (c[pos[0]][i] + c[pos[1]][i] + c[neg[0]][i] + c[neg[1]][i]) / 4;
    const w = (half / cal.scale[i]) ** 2; // features that separate the sides by more spreads count more
    num += w * ((vec[i] - mid) / half);
    den += w;
  });
  return den > 0 ? num / den : NaN;
}

/** Scaled distance from `vec` to each target's centroid (kept for drift checks and diagnostics). */
export function targetDistances(cal: QuadrantCalibration, vec: readonly number[]): Record<QuadrantTarget, number> {
  const out = {} as Record<QuadrantTarget, number>;
  for (const k of QUADRANT_TARGETS) {
    out[k] = Math.hypot(...cal.centroids[k].map((c, i) => (vec[i] - c) / cal.scale[i]));
  }
  return out;
}

const quadrantAt = (x: number, y: number): Quadrant => (y < 0 ? (x < 0 ? "topLeft" : "topRight") : x < 0 ? "bottomLeft" : "bottomRight");

/**
 * Target for `vec`, deciding left/right and top/bottom separately. Inside `dead` of the center on both
 * axes it is the rest circle. With `current`, an axis keeps its side until the position is `margin`
 * past the midline the other way (hysteresis), and the rest circle is left only past `dead`.
 */
export function nearestTarget(
  cal: QuadrantCalibration,
  vec: readonly number[],
  current: QuadrantTarget | null = null,
  margin = 0,
  dead = DEFAULT_QUADRANT.dead,
): QuadrantTarget {
  const x = axisPosition(cal, vec, "x");
  const y = axisPosition(cal, vec, "y");
  if (!Number.isFinite(x) || !Number.isFinite(y)) return current ?? "center";
  const inDead = Math.abs(x) < dead && Math.abs(y) < dead;
  if (current === "center" || current === null) {
    if (inDead || (current === "center" && Math.abs(x) < dead + margin && Math.abs(y) < dead + margin)) return "center";
    return quadrantAt(x, y);
  }
  // Currently on a box: stay unless the eyes have clearly crossed to another side or settled in the middle.
  if (Math.abs(x) < dead - margin && Math.abs(y) < dead - margin) return "center";
  const curX = current === "topRight" || current === "bottomRight" ? 1 : -1;
  const curY = current === "bottomLeft" || current === "bottomRight" ? 1 : -1;
  const sx = x * curX < -margin ? -curX : curX;
  const sy = y * curY < -margin ? -curY : curY;
  return quadrantAt(sx, sy);
}

/**
 * Per-feature medians and spreads from looks at the center and each box corner. Returns null if no
 * feature had enough samples for every target. Accuracy is how the calibration looks classify back.
 */
export function fitQuadrants(samples: Record<QuadrantTarget, readonly EyeFrame[]>, minSamples = 10): QuadrantCalibration | null {
  const dims = GAZE_FEATURES.filter((d) =>
    QUADRANT_TARGETS.every((k) => samples[k].filter((f) => Number.isFinite(f[d])).length >= minSamples),
  );
  if (dims.length === 0) return null;

  const values = (k: QuadrantTarget, i: number) => samples[k].map((f) => f[dims[i]]).filter(Number.isFinite);
  const centroids = Object.fromEntries(QUADRANT_TARGETS.map((k) => [k, dims.map((_, i) => median(values(k, i)))])) as Record<
    QuadrantTarget,
    number[]
  >;
  const scale = dims.map((_, i) => {
    const pooled = Math.sqrt(QUADRANT_TARGETS.reduce((s, k) => s + robustSpread(values(k, i)) ** 2, 0) / QUADRANT_TARGETS.length);
    const cs = QUADRANT_TARGETS.map((k) => centroids[k][i]);
    // A steady stare at a dot is quieter than real use (about 3x in a recorded session), and a feature
    // with near-zero noise must not dominate on its own: floor the spread at a share of the target range.
    return Math.max(pooled, 0.1 * (Math.max(...cs) - Math.min(...cs)), 1e-6);
  });

  const cal: QuadrantCalibration = { dims: [...dims], centroids, scale, accuracy: {} as Record<QuadrantTarget, number> };
  for (const k of QUADRANT_TARGETS) {
    const vecs = samples[k].map((f) => featureVector(f, dims)).filter((v) => v.every(Number.isFinite));
    cal.accuracy[k] = vecs.filter((v) => nearestTarget(cal, v) === k).length / vecs.length;
  }
  return cal;
}

/**
 * Move one box's centroid toward where the eyes actually were when the patient chose it (a pick that
 * was spoken and not undone). `rate` is the share of the gap closed per lesson; small, so one odd pick
 * can't drag a box far, and bounded, because every lesson is for the box that was chosen.
 */
export function learnTarget(cal: QuadrantCalibration, target: Quadrant, vec: readonly number[], rate = 0.2): void {
  if (!vec.every(Number.isFinite)) return;
  const c = cal.centroids[target];
  c.forEach((v, i) => {
    c[i] = v + rate * (vec[i] - v);
  });
}

export interface QuadrantConfig {
  /** A target must be looked at this long before it becomes the focus. Reading inside a box never changes anything. */
  focusMs: number;
  /** Hysteresis, as a share of the center-to-side distance on each axis. */
  margin: number;
  /** Half-width of the rest circle on each axis, as a share of the center-to-side distance. */
  dead: number;
  /** Median filter length in frames, per feature. */
  smoothingFrames: number;
}

export const DEFAULT_QUADRANT: QuadrantConfig = { focusMs: 300, margin: 0.15, dead: 0.3, smoothingFrames: 5 };

export interface QuadrantState {
  /** Target the eyes are on right now (smoothed), or null with no data yet. */
  looking: QuadrantTarget | null;
  /** Box a long blink or held squint would select. Null when the user has settled on the rest circle. */
  focus: Quadrant | null;
  /** 0..1 progress of `looking` toward becoming the focus; 1 once it is. */
  focusProgress: number;
  /** Where the eyes are on each axis, -1 (left/top) to +1 (right/bottom), after smoothing. */
  position: { x: number; y: number } | null;
}

export interface QuadrantEvent {
  type: "focus";
  t: number;
  quadrant: Quadrant | null;
}

export class QuadrantClassifier {
  private readonly filters: MedianFilter[];
  private looking: QuadrantTarget | null = null;
  private focus: Quadrant | null = null;
  private since = 0;
  private lastT: number | null = null;
  private position: { x: number; y: number } | null = null;
  /** Smoothed feature vectors from the last `recentMs` of open-eye looking, for learning from a pick. */
  private recent: { t: number; vec: number[] }[] = [];
  private readonly recentMs = 600;

  constructor(
    readonly calibration: QuadrantCalibration,
    readonly cfg: QuadrantConfig = { ...DEFAULT_QUADRANT },
  ) {
    this.filters = calibration.dims.map(() => new MedianFilter(cfg.smoothingFrames));
  }

  update(t: number, frame: EyeFrame, frozen: boolean): { state: QuadrantState; events: QuadrantEvent[] } {
    const events: QuadrantEvent[] = [];
    const dt = this.lastT === null ? 0 : t - this.lastT;
    this.lastT = t;

    const raw = featureVector(frame, this.calibration.dims);
    if (frozen || !raw.every(Number.isFinite)) {
      // Freeze during a hold: the lids drag vertical gaze features down, and the focus is what the hold selects.
      this.since += dt;
      return { state: this.snapshot(t), events };
    }

    const vec = raw.map((v, i) => this.filters[i].push(v));
    this.recent.push({ t, vec });
    while (this.recent.length && t - this.recent[0].t > this.recentMs) this.recent.shift();
    this.position = { x: axisPosition(this.calibration, vec, "x"), y: axisPosition(this.calibration, vec, "y") };
    const target = nearestTarget(this.calibration, vec, this.looking, this.cfg.margin, this.cfg.dead);
    if (target !== this.looking) {
      this.looking = target;
      this.since = t;
    }
    const next = target === "center" ? null : target;
    if (next !== this.focus && t - this.since >= this.cfg.focusMs) {
      this.focus = next;
      events.push({ type: "focus", t, quadrant: next });
    }
    return { state: this.snapshot(t), events };
  }

  /** Median of the looks just before the eyes closed: where the patient was looking when they chose. */
  lookBeforeHold(): number[] | null {
    if (this.recent.length < 3) return null;
    return this.calibration.dims.map((_, i) => median(this.recent.map((r) => r.vec[i])));
  }

  private snapshot(t: number): QuadrantState {
    let focusProgress = 0;
    if (this.looking) {
      const asFocus = this.looking === "center" ? null : this.looking;
      focusProgress = asFocus === this.focus ? 1 : Math.min(1, (t - this.since) / this.cfg.focusMs);
    }
    return { looking: this.looking, focus: this.focus, focusProgress, position: this.position };
  }
}
