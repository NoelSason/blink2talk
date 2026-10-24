import { MedianFilter } from "./stats";

/** EAR levels for the closed/open hysteresis band. `close` < `open`. */
export interface Thresholds {
  close: number;
  open: number;
}

export interface BlinkConfig {
  /** Hold time (eyes closed or squinting) that counts as a deliberate selection (report: 800 ms, tunable 600–1,500). */
  selectMs: number;
  /** After a selection, holds that start within this window cannot select (report: 1.2 s). */
  refractoryMs: number;
  /** Eyes fully closed this long means "rest" / pause instead of a select (report: 3 s). */
  restMs: number;
  /** Median filter length in frames. */
  smoothingFrames: number;
}

export const DEFAULT_BLINK: BlinkConfig = { selectMs: 800, refractoryMs: 1200, restMs: 3000, smoothingFrames: 3 };

/** "blink" if the eyes fully closed at any point during the hold, otherwise "squint". */
export type HoldKind = "blink" | "squint";

export type BlinkEvent =
  | { type: "holdStart"; t: number }
  /** A full closure that ended without selecting: a natural blink, an aborted select, or one during the refractory period. */
  | { type: "blink"; t: number; durationMs: number }
  | { type: "select"; t: number; durationMs: number; via: HoldKind }
  | { type: "rest"; t: number }
  | { type: "restEnd"; t: number; durationMs: number };

export interface BlinkState {
  /** Eyes closed or squinting: a hold is in progress. */
  engaged: boolean;
  /** Eyes fully closed (EAR below the closed threshold). */
  closed: boolean;
  heldMs: number;
  /** 0..1 fill progress toward a selection. 0 when this hold cannot select. */
  progress: number;
  refractory: boolean;
  /** Smoothed EAR. */
  ear: number;
}

/**
 * Long-blink / held-squint selection. A select fires when the hold is released after ≥ selectMs, so a
 * fill bar can complete while the eyes are shut and holding on to restMs becomes a rest instead.
 */
export class BlinkDetector {
  private readonly filter: MedianFilter;
  private ear = NaN;
  private closed = false;
  private closedSince = 0;
  private engaged = false;
  private holdStart = 0;
  private fullyClosed = false;
  private canSelect = false;
  private rested = false;
  private refractoryUntil = -Infinity;

  /** `cfg` is read live, so callers can tune `selectMs` while running. */
  constructor(
    public thresholds: Thresholds,
    readonly cfg: BlinkConfig = { ...DEFAULT_BLINK },
  ) {
    this.filter = new MedianFilter(cfg.smoothingFrames);
  }

  update(t: number, rawEar: number, squinting = false): { state: BlinkState; events: BlinkEvent[] } {
    const events: BlinkEvent[] = [];
    if (!Number.isFinite(rawEar)) {
      // Face lost mid-hold: drop the hold rather than risk a select the patient never made.
      this.engaged = this.closed = false;
      this.ear = NaN;
      this.filter.reset();
      return { state: this.snapshot(t), events };
    }

    const ear = (this.ear = this.filter.push(rawEar));
    if (!this.closed && ear < this.thresholds.close) {
      this.closed = true;
      this.closedSince = t;
    } else if (this.closed && ear > this.thresholds.open) this.closed = false;

    const engaged = this.closed || squinting;
    if (engaged && !this.engaged) {
      this.holdStart = t;
      this.fullyClosed = this.rested = false;
      this.canSelect = t >= this.refractoryUntil;
      events.push({ type: "holdStart", t });
    }
    this.fullyClosed ||= this.closed;

    if (engaged) {
      if (!this.rested && this.closed && t - this.closedSince >= this.cfg.restMs) {
        this.rested = true;
        events.push({ type: "rest", t });
      }
    } else if (this.engaged) {
      const durationMs = t - this.holdStart;
      if (this.rested) events.push({ type: "restEnd", t, durationMs });
      else if (this.canSelect && durationMs >= this.cfg.selectMs) {
        this.refractoryUntil = t + this.cfg.refractoryMs;
        events.push({ type: "select", t, durationMs, via: this.fullyClosed ? "blink" : "squint" });
      } else if (this.fullyClosed) events.push({ type: "blink", t, durationMs });
    }
    this.engaged = engaged;
    return { state: this.snapshot(t), events };
  }

  private snapshot(t: number): BlinkState {
    const heldMs = this.engaged ? t - this.holdStart : 0;
    const armable = this.engaged && this.canSelect && !this.rested;
    return {
      engaged: this.engaged,
      closed: this.closed,
      heldMs,
      progress: armable ? Math.min(1, heldMs / this.cfg.selectMs) : 0,
      refractory: t < this.refractoryUntil,
      ear: this.ear,
    };
  }
}
