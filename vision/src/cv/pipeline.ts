import { BlinkDetector, DEFAULT_BLINK, type BlinkConfig, type BlinkEvent, type BlinkState, type HoldKind } from "./blink";
import {
  Calibrator,
  DEFAULT_CALIBRATION,
  type CalibrationConfig,
  type CalibrationProgress,
  type CalibrationResult,
} from "./calibration";
import { DEFAULT_FATIGUE, FatigueMonitor, type FatigueConfig, type FatigueEvent, type FatigueSnapshot } from "./fatigue";
import { DEFAULT_GAZE, GazeClassifier, type GazeConfig, type GazeEvent, type GazeState } from "./gaze";
import {
  DEFAULT_QUADRANT,
  QuadrantClassifier,
  type Quadrant,
  type QuadrantConfig,
  type QuadrantEvent,
  type QuadrantState,
 learnTarget } from "./quadrant";
import type { EyeFrame } from "./types";

export type PipelineMode = "idle" | "calibrating" | "running";

export type PipelineEvent =
  | BlinkEvent
  | GazeEvent
  | QuadrantEvent
  | FatigueEvent
  /** Quadrant layout: a select, with the box that had focus when the hold started (null = rest circle). */
  | { type: "quadrantSelect"; t: number; quadrant: Quadrant | null; via: HoldKind; look: number[] | null }
  | { type: "calibrated"; t: number; result: CalibrationResult }
  | { type: "calibrationFailed"; t: number; reason: string }
  | { type: "faceLost"; t: number }
  | { type: "faceFound"; t: number };

export interface PipelineOutput {
  t: number;
  mode: PipelineMode;
  faceFound: boolean;
  /** Raw EAR (NaN without a face). */
  ear: number;
  squinting: boolean;
  calibration?: CalibrationProgress;
  blink?: BlinkState;
  /** Left/right layout only; absent when gaze calibration failed. */
  gaze?: GazeState;
  /** Quadrant layout only. */
  quadrant?: QuadrantState;
  fatigue?: FatigueSnapshot;
  events: PipelineEvent[];
}

export interface PipelineConfig {
  calibration: CalibrationConfig;
  blink: BlinkConfig;
  gaze: GazeConfig;
  quadrant: QuadrantConfig;
  fatigue: FatigueConfig;
}

export interface PipelineOptions {
  calibration?: Partial<CalibrationConfig>;
  blink?: Partial<BlinkConfig>;
  gaze?: Partial<GazeConfig>;
  quadrant?: Partial<QuadrantConfig>;
  fatigue?: Partial<FatigueConfig>;
}

/** EyeFrame in, UI-ready state and events out. No DOM or MediaPipe dependency, so it runs in tests and replays. */
export class EyePipeline {
  readonly cfg: PipelineConfig;
  private _mode: PipelineMode = "idle";
  private _calibration: CalibrationResult | null = null;
  private calibrator: Calibrator | null = null;
  private blink: BlinkDetector | null = null;
  private gaze: GazeClassifier | null = null;
  private quadrant: QuadrantClassifier | null = null;
  private fatigue: FatigueMonitor | null = null;
  private armedQuadrant: Quadrant | null = null;
  /** Smoothed look just before the hold began; handed back by the app with `learn()` once the pick is spoken. */
  private armedLook: number[] | null = null;
  private squinting = false;
  private faceFound = false;

  constructor(opts: PipelineOptions = {}) {
    this.cfg = {
      calibration: { ...DEFAULT_CALIBRATION, ...opts.calibration },
      blink: { ...DEFAULT_BLINK, ...opts.blink },
      gaze: { ...DEFAULT_GAZE, ...opts.gaze },
      quadrant: { ...DEFAULT_QUADRANT, ...opts.quadrant },
      fatigue: { ...DEFAULT_FATIGUE, ...opts.fatigue },
    };
  }

  get mode(): PipelineMode {
    return this._mode;
  }

  get calibration(): CalibrationResult | null {
    return this._calibration;
  }

  /** Total calibration time for the configured layout, for UI copy. */
  get calibrationMs(): number {
    return new Calibrator(this.cfg.calibration).totalMs;
  }

  startCalibration(): void {
    this.calibrator = new Calibrator({ ...this.cfg.calibration });
    this._mode = "calibrating";
  }

  /** Start running with a calibration, e.g. one saved earlier for the same patient and setup. */
  useCalibration(result: CalibrationResult): void {
    this._calibration = result;
    this.blink = new BlinkDetector(result.thresholds, this.cfg.blink);
    this.gaze = result.gaze ? new GazeClassifier(result.gaze, this.cfg.gaze) : null;
    this.quadrant = result.quadrants ? new QuadrantClassifier(result.quadrants, this.cfg.quadrant) : null;
    this.fatigue = new FatigueMonitor(this.cfg.fatigue);
    this.armedQuadrant = null;
    this.squinting = false;
    this.calibrator = null;
    this._mode = "running";
  }

  /**
   * A pick the patient let stand (spoken, not undone) is a labeled look: nudge that box's calibrated
   * centroid toward it, so the boxes follow slow drift (posture, eyelids) without a recalibration.
   */
  learn(quadrant: Quadrant, look: readonly number[] | null, rate = 0.2): void {
    if (!look || !this.quadrant) return;
    learnTarget(this.quadrant.calibration, quadrant, look, rate);
  }

  /** Takes effect immediately (except `smoothingFrames`, which applies at the next calibration). */
  setBlinkConfig(patch: Partial<BlinkConfig>): void {
    Object.assign(this.cfg.blink, patch);
  }

  process(frame: EyeFrame): PipelineOutput {
    const { t } = frame;
    const events: PipelineEvent[] = [];
    if (frame.faceFound !== this.faceFound) {
      this.faceFound = frame.faceFound;
      events.push({ type: frame.faceFound ? "faceFound" : "faceLost", t });
    }
    const out: PipelineOutput = { t, mode: this._mode, faceFound: frame.faceFound, ear: frame.ear, squinting: false, events };

    if (this._mode === "calibrating" && this.calibrator) {
      out.calibration = this.calibrator.add(frame);
      if (out.calibration.phase === "done") {
        try {
          const result = this.calibrator.result();
          this.useCalibration(result);
          events.push({ type: "calibrated", t, result });
        } catch (err) {
          this.calibrator = null;
          this._mode = this._calibration ? "running" : "idle";
          events.push({ type: "calibrationFailed", t, reason: err instanceof Error ? err.message : String(err) });
        }
        out.mode = this._mode;
      }
      return out;
    }

    if (this._mode !== "running" || !this.blink || !this.fatigue) return out;

    out.squinting = this.updateSquint(frame);
    const b = this.blink.update(t, frame.ear, out.squinting);
    out.blink = b.state;
    events.push(...b.events);
    for (const e of b.events) if (e.type === "blink") this.fatigue.addBlink(e.t, e.durationMs);
    if (!b.state.engaged && Number.isFinite(frame.ear)) this.fatigue.addOpenSample(t, frame.ear);

    const frozen = b.state.engaged || !frame.faceFound;
    if (this.gaze) {
      const g = this.gaze.update(t, frame.gazeX, frozen);
      out.gaze = g.state;
      events.push(...g.events);
    }
    if (this.quadrant) {
      // The classifier is frozen during a hold, so on holdStart its focus is still the box the user
      // was looking at, before the lids could drag the gaze estimate down.
      const q = this.quadrant.update(t, frame, frozen);
      for (const e of b.events) {
        if (e.type === "holdStart") {
          this.armedQuadrant = q.state.focus;
          this.armedLook = this.quadrant.lookBeforeHold();
        }
        if (e.type === "select") events.push({ type: "quadrantSelect", t, quadrant: this.armedQuadrant, via: e.via, look: this.armedLook });
      }
      out.quadrant = q.state;
      events.push(...q.events);
    }

    const f = this.fatigue.update(t);
    out.fatigue = f.snapshot;
    events.push(...f.events);
    return out;
  }

  /** Hysteresis on the calibrated squint signal: 0 at `off` (normal side), 1 at `on`. */
  private updateSquint(frame: EyeFrame): boolean {
    const s = this._calibration?.squint;
    if (!s || !frame.faceFound) return (this.squinting = false);
    const r = (frame[s.feature] - s.off) / (s.on - s.off);
    if (r >= 1) this.squinting = true;
    else if (r <= 0 || !Number.isFinite(r)) this.squinting = false;
    return this.squinting;
  }
}
