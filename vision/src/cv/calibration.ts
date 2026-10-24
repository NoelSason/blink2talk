import type { Thresholds } from "./blink";
import type { GazeCalibration } from "./gaze";
import { fitQuadrants, QUADRANT_TARGETS, type Quadrant, type QuadrantCalibration, type QuadrantTarget } from "./quadrant";
import { mean, median, robustSpread } from "./stats";
import type { EyeFrame } from "./types";

/** "leftRight": scan list driven by left/right glances. "quadrants": four boxes picked by where you look. */
export type CalibrationLayout = "leftRight" | "quadrants";
/** "ready" is a countdown before the first dot; no samples are taken during it. */
export type CalibrationPhase = "ready" | "center" | "left" | "right" | Quadrant | "squint" | "done";
type SamplePhase = Exclude<CalibrationPhase, "ready" | "done">;

const PHASES: Record<CalibrationLayout, readonly CalibrationPhase[]> = {
  leftRight: ["ready", "center", "left", "right", "squint", "done"],
  quadrants: ["ready", "center", "topLeft", "topRight", "bottomRight", "bottomLeft", "squint", "done"],
};

export interface CalibrationConfig {
  layout: CalibrationLayout;
  /** Countdown before the first dot. */
  readyMs: number;
  /** Length of every dot phase. */
  phaseMs: number;
  /** Ignored at the start of each phase while the eyes move to the new dot. */
  settleMs: number;
  /** Closed threshold as a fraction of the narrowest normal open-eye EAR (report: 60–70%). */
  closedFraction: number;
  /** Open threshold sits this far above the closed one (report: T + 0.05). */
  hysteresis: number;
  /** Minimum iris-ratio difference between center and each side for left/right gaze to be usable. */
  minGazeSpread: number;
  /** Quadrant targets classified correctly less often than this during calibration get a warning. */
  minQuadrantAccuracy: number;
  /** Squint must differ from every normal look by this many robust standard deviations to be used. */
  minSquintSeparation: number;
  minSamples: number;
}

export const DEFAULT_CALIBRATION: CalibrationConfig = {
  layout: "leftRight",
  readyMs: 3000,
  phaseMs: 2000,
  settleMs: 500,
  closedFraction: 0.65,
  hysteresis: 0.05,
  minGazeSpread: 0.03,
  minQuadrantAccuracy: 0.7,
  minSquintSeparation: 3,
  minSamples: 10,
};

/** Squinting starts when `feature` crosses `on` and ends when it crosses back past `off` (toward normal). */
export interface SquintCalibration {
  feature: "ear" | "squint";
  on: number;
  off: number;
}

export interface CalibrationResult {
  layout: CalibrationLayout;
  /** Median EAR while looking at the center. */
  openBaseline: number;
  thresholds: Thresholds;
  /** Left/right gaze; null for the quadrant layout or when it couldn't be calibrated. */
  gaze: GazeCalibration | null;
  /** Quadrant gaze; null for the left/right layout or when it couldn't be calibrated. */
  quadrants: QuadrantCalibration | null;
  /** Null when a squint couldn't be told apart from normal looks; full blinks still work. */
  squint: SquintCalibration | null;
  warnings: string[];
}

export interface CalibrationProgress {
  phase: CalibrationPhase;
  /** 0..1 within the current phase. */
  progress: number;
  /** Time left in the current phase, for a countdown. */
  remainingMs: number;
}

/** Per-user calibration instead of training: a countdown, a couple of seconds on each dot, then a squint. */
export class Calibrator {
  private step = 0;
  private phaseStart: number | null = null;
  private readonly samples = new Map<SamplePhase, EyeFrame[]>();
  private readonly phases: readonly CalibrationPhase[];

  constructor(readonly cfg: CalibrationConfig = { ...DEFAULT_CALIBRATION }) {
    this.phases = PHASES[cfg.layout];
  }

  get phase(): CalibrationPhase {
    return this.phases[this.step];
  }

  get totalMs(): number {
    return this.cfg.readyMs + (this.phases.length - 2) * this.cfg.phaseMs;
  }

  add(frame: EyeFrame): CalibrationProgress {
    const phase = this.phase;
    if (phase === "done") return { phase, progress: 1, remainingMs: 0 };
    this.phaseStart ??= frame.t;
    const elapsed = frame.t - this.phaseStart;
    const duration = phase === "ready" ? this.cfg.readyMs : this.cfg.phaseMs;

    if (phase !== "ready" && frame.faceFound && elapsed >= this.cfg.settleMs) this.samples.set(phase, [...this.frames(phase), frame]);

    if (elapsed >= duration) {
      this.step++;
      this.phaseStart = frame.t;
      const next = this.phase;
      return { phase: next, progress: next === "done" ? 1 : 0, remainingMs: next === "done" ? 0 : this.cfg.phaseMs };
    }
    return { phase, progress: Math.min(1, elapsed / duration), remainingMs: duration - elapsed };
  }

  /** Throws if calibration isn't finished or the face wasn't visible while looking at the center. */
  result(): CalibrationResult {
    if (this.phase !== "done") throw new Error("calibration is not finished");
    const ears = (p: SamplePhase) => this.frames(p).map((f) => f.ear).filter(Number.isFinite);
    if (ears("center").length < this.cfg.minSamples) throw new Error("face was not visible while looking at the center");

    const warnings: string[] = [];
    const normal = this.phases.filter((p): p is SamplePhase => p !== "ready" && p !== "done" && p !== "squint");
    const openBaseline = median(ears("center"));
    // Looking down lowers the upper lid, so thresholds come from the narrowest normal look, not the
    // center. Otherwise a look at a bottom box could register as a closed eye.
    const lowestOpen = Math.min(...normal.map((p) => median(ears(p))).filter(Number.isFinite));
    if (lowestOpen < 0.8 * openBaseline) warnings.push("Eyes narrow noticeably when looking down; blink thresholds were lowered to match.");
    const close = lowestOpen * this.cfg.closedFraction;
    // Keep the open threshold below the open level even for people with narrow eyes.
    const open = Math.min(close + this.cfg.hysteresis, (close + lowestOpen) / 2);

    // Gaze and squint references use only frames with the eyes open; blink frames carry no gaze information.
    const openFrames = (p: SamplePhase) => this.frames(p).filter((f) => f.ear > close);

    let gaze: GazeCalibration | null = null;
    let quadrants: QuadrantCalibration | null = null;
    if (this.cfg.layout === "leftRight") gaze = this.fitLeftRight(openFrames, warnings);
    else {
      const byTarget = Object.fromEntries(QUADRANT_TARGETS.map((k) => [k, openFrames(k)])) as Record<QuadrantTarget, EyeFrame[]>;
      quadrants = fitQuadrants(byTarget, this.cfg.minSamples);
      const weak = quadrants ? QUADRANT_TARGETS.filter((k) => quadrants!.accuracy[k] < this.cfg.minQuadrantAccuracy) : [];
      if (!quadrants) warnings.push("Face not visible during gaze calibration; quadrant gaze is off.");
      else if (weak.length) {
        warnings.push(`Hard to tell apart: ${weak.join(", ")}. Make the eye movements bigger (screen closer, camera at eye level) and recalibrate.`);
      }
    }

    const squint = this.fitSquint(normal.map(openFrames));
    if (!squint) warnings.push("Squint couldn't be told apart from normal looks; select with full blinks.");

    return { layout: this.cfg.layout, openBaseline, thresholds: { close, open }, gaze, quadrants, squint, warnings };
  }

  private frames(phase: SamplePhase): EyeFrame[] {
    return this.samples.get(phase) ?? [];
  }

  /**
   * Picks whichever signal separates a deliberate squint from the most squint-like normal look best:
   * EAR (squinting lowers it) or the eyeSquint blendshape (squinting raises it).
   */
  private fitSquint(normalGroups: EyeFrame[][]): SquintCalibration | null {
    let best: SquintCalibration | null = null;
    let bestScore = this.cfg.minSquintSeparation;
    for (const [feature, sign] of [["ear", -1], ["squint", 1]] as const) {
      const vals = (fs: EyeFrame[]) => fs.map((f) => f[feature]).filter(Number.isFinite);
      const groups = normalGroups.map(vals);
      const sq = vals(this.frames("squint"));
      if (sq.length < this.cfg.minSamples || groups.some((g) => g.length < this.cfg.minSamples)) continue;
      const q = median(sq);
      const medians = groups.map(median);
      const extreme = sign < 0 ? Math.min(...medians) : Math.max(...medians);
      const spread = Math.sqrt(mean([...groups, sq].map((g) => robustSpread(g) ** 2)));
      const score = ((q - extreme) * sign) / Math.max(spread, 1e-6);
      if (score >= bestScore) {
        bestScore = score;
        best = { feature, on: q + 0.5 * (extreme - q), off: q + 0.75 * (extreme - q) };
      }
    }
    return best;
  }

  private fitLeftRight(openFrames: (p: SamplePhase) => EyeFrame[], warnings: string[]): GazeCalibration | null {
    const xs = (p: SamplePhase) => openFrames(p).map((f) => f.gazeX).filter(Number.isFinite);
    const [center, left, right] = [xs("center"), xs("left"), xs("right")];
    if (Math.min(center.length, left.length, right.length) < this.cfg.minSamples) {
      warnings.push("Face not visible during gaze calibration; gaze is off.");
      return null;
    }
    const c = median(center);
    const l = median(left);
    const r = median(right);
    const spread = this.cfg.minGazeSpread;
    if ((l - c) * (r - c) < 0 && Math.abs(l - c) >= spread && Math.abs(r - c) >= spread) return { left: l, center: c, right: r };
    warnings.push("Left and right looks were too similar; gaze is off. Recalibrate with bigger eye movements.");
    return null;
  }
}
