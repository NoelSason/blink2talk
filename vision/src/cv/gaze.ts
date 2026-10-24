import { MedianFilter } from "./stats";

export type GazeDirection = "left" | "center" | "right";

/** Median iris ratio while the user looked at each calibration target. */
export interface GazeCalibration {
  left: number;
  center: number;
  right: number;
}

export interface GazeConfig {
  /** How long a left/right look must be held before it fires (report: ≥ 700 ms). */
  dwellMs: number;
  /** After firing, center must be held this long before another look can fire. */
  rearmMs: number;
  /**
   * Hysteresis: to switch direction, the new target must be closer than the current one by this
   * fraction of the smaller center-to-side distance. Stops noise near a boundary from flickering.
   */
  hysteresis: number;
  /** Median filter length in frames; iris landmarks jitter more than lid landmarks. */
  smoothingFrames: number;
}

export const DEFAULT_GAZE: GazeConfig = { dwellMs: 700, rearmMs: 300, hysteresis: 0.25, smoothingFrames: 5 };

export interface GazeEvent {
  type: "gaze";
  t: number;
  direction: "left" | "right";
}

export interface GazeState {
  direction: GazeDirection;
  /** 0..1 progress toward firing; stays at 1 after firing until the user re-arms by looking at center. */
  dwellProgress: number;
  /** Smoothed iris ratio. */
  ratio: number;
}

/** Left / center / right only: vertical gaze is confounded with eyelid closure on a webcam. */
export class GazeClassifier {
  private readonly filter: MedianFilter;
  private readonly margin: number;
  private direction: GazeDirection = "center";
  private since = 0;
  private armed = true;
  private lastT: number | null = null;
  private ratio = NaN;

  constructor(
    readonly calibration: GazeCalibration,
    readonly cfg: GazeConfig = { ...DEFAULT_GAZE },
  ) {
    this.filter = new MedianFilter(cfg.smoothingFrames);
    const { left, center, right } = calibration;
    this.margin = cfg.hysteresis * Math.min(Math.abs(left - center), Math.abs(right - center));
  }

  /**
   * Nearest calibration target, staying with `current` unless another target is clearly closer.
   * Direction comes from the calibration labels, so a mirrored camera needs no special case.
   */
  classify(ratio: number, current?: GazeDirection): GazeDirection {
    const d = (k: GazeDirection) => Math.abs(ratio - this.calibration[k]);
    let best: GazeDirection = "center";
    if (d("left") < d(best)) best = "left";
    if (d("right") < d(best)) best = "right";
    if (current && best !== current && d(current) - d(best) < this.margin) return current;
    return best;
  }

  update(t: number, rawRatio: number, eyesClosed: boolean): { state: GazeState; events: GazeEvent[] } {
    const events: GazeEvent[] = [];
    const dt = this.lastT === null ? 0 : t - this.lastT;
    this.lastT = t;

    if (eyesClosed || !Number.isFinite(rawRatio)) {
      // The iris is hidden; pause the dwell timer instead of resetting it so a natural blink doesn't cancel a glance.
      this.since += dt;
      return { state: this.snapshot(t), events };
    }

    this.ratio = this.filter.push(rawRatio);
    const dir = this.classify(this.ratio, this.direction);
    if (dir !== this.direction) {
      // Going straight from one side to the other is a deliberate move, so it re-arms.
      if (dir !== "center" && this.direction !== "center") this.armed = true;
      this.direction = dir;
      this.since = t;
    }
    const held = t - this.since;
    if (dir === "center") {
      if (held >= this.cfg.rearmMs) this.armed = true;
    } else if (this.armed && held >= this.cfg.dwellMs) {
      this.armed = false;
      events.push({ type: "gaze", t, direction: dir });
    }
    return { state: this.snapshot(t), events };
  }

  private snapshot(t: number): GazeState {
    let dwellProgress = 0;
    if (this.direction !== "center") dwellProgress = this.armed ? Math.min(1, (t - this.since) / this.cfg.dwellMs) : 1;
    return { direction: this.direction, dwellProgress, ratio: this.ratio };
  }
}
