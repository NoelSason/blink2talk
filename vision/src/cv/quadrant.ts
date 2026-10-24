import { median, MedianFilter, robustSpread } from "./stats";
import type { EyeFrame } from "./types";

export const QUADRANTS = ["topLeft", "topRight", "bottomRight", "bottomLeft"] as const;
export type Quadrant = (typeof QUADRANTS)[number];
/** "center" is the rest circle where the boxes meet: looking there focuses nothing. */
export type QuadrantTarget = Quadrant | "center";
export const QUADRANT_TARGETS: readonly QuadrantTarget[] = ["center", ...QUADRANTS];

export const GAZE_FEATURES = ["gazeX", "gazeY", "lookX", "lookY"] as const;
export type GazeFeature = (typeof GAZE_FEATURES)[number];

/**
 * Calibration dot positions in normalized area coordinates (x and y in [-1, 1], +y down): the center
 * and the middle of each box of a 2×2 grid, which is where the user looks to read an answer.
 */
export const TARGET_POSITIONS: Record<QuadrantTarget, readonly [number, number]> = {
  center: [0, 0],
  topLeft: [-0.5, -0.5],
  topRight: [0.5, -0.5],
  bottomRight: [0.5, 0.5],
  bottomLeft: [-0.5, 0.5],
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

/** Scaled distance from `vec` to each target's centroid. */
export function targetDistances(cal: QuadrantCalibration, vec: readonly number[]): Record<QuadrantTarget, number> {
  const out = {} as Record<QuadrantTarget, number>;
  for (const k of QUADRANT_TARGETS) {
    out[k] = Math.hypot(...cal.centroids[k].map((c, i) => (vec[i] - c) / cal.scale[i]));
  }
  return out;
}

/** Nearest target, staying with `current` unless another is closer by `margin` scaled units. */
export function nearestTarget(cal: QuadrantCalibration, vec: readonly number[], current: QuadrantTarget | null = null, margin = 0): QuadrantTarget {
  const d = targetDistances(cal, vec);
  const best = QUADRANT_TARGETS.reduce((b, k) => (d[k] < d[b] ? k : b));
  return current && best !== current && d[current] - d[best] < margin ? current : best;
}

/**
 * Nearest centroid with per-feature scaling (a diagonal LDA), fit from looks at each box center.
 * Scaling by within-target spread lets whichever features separate the boxes best for this person
 * dominate. Returns null if no feature had enough samples for every target.
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
    // Floor the scale so a dimension with near-zero noise can't dominate on its own.
    return Math.max(pooled, 0.05 * (Math.max(...cs) - Math.min(...cs)), 1e-6);
  });

  const cal: QuadrantCalibration = { dims: [...dims], centroids, scale, accuracy: {} as Record<QuadrantTarget, number> };
  for (const k of QUADRANT_TARGETS) {
    const vecs = samples[k].map((f) => featureVector(f, dims)).filter((v) => v.every(Number.isFinite));
    cal.accuracy[k] = vecs.filter((v) => nearestTarget(cal, v) === k).length / vecs.length;
  }
  return cal;
}

export interface QuadrantConfig {
  /** A target must be looked at this long before it becomes the focus. Reading inside a box never changes anything. */
  focusMs: number;
  /** Stay with the current target unless another is closer by this many scaled units (hysteresis). */
  margin: number;
  /** Median filter length in frames, per feature. */
  smoothingFrames: number;
}

export const DEFAULT_QUADRANT: QuadrantConfig = { focusMs: 300, margin: 0.5, smoothingFrames: 5 };

export interface QuadrantState {
  /** Target the eyes are on right now (smoothed), or null with no data yet. */
  looking: QuadrantTarget | null;
  /** Box a long blink or held squint would select. Null when the user has settled on the rest circle. */
  focus: Quadrant | null;
  /** 0..1 progress of `looking` toward becoming the focus; 1 once it is. */
  focusProgress: number;
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
    const target = nearestTarget(this.calibration, vec, this.looking, this.cfg.margin);
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

  private snapshot(t: number): QuadrantState {
    let focusProgress = 0;
    if (this.looking) {
      const asFocus = this.looking === "center" ? null : this.looking;
      focusProgress = asFocus === this.focus ? 1 : Math.min(1, (t - this.since) / this.cfg.focusMs);
    }
    return { looking: this.looking, focus: this.focus, focusProgress };
  }
}
