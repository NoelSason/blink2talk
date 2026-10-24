import { mean, median } from "./stats";

export interface FatigueConfig {
  /** Per-patient baseline length (report: first 5 minutes). */
  baselineMs: number;
  /** Rolling window for the current estimate (report: 60 s). */
  windowMs: number;
  /** Blink rate counts as raised at ≥ baseline × rateRatio … */
  rateRatio: number;
  /** … and at least this many blinks/min above baseline, so a near-zero baseline doesn't trip on one blink. */
  minRateIncrease: number;
  /** Mean natural-blink duration counts as raised at ≥ baseline × durationRatio. */
  durationRatio: number;
  /** Open-eye openness counts as drooping at ≤ baseline × opennessRatio. */
  opennessRatio: number;
  /** Closures longer than this are deliberate, not spontaneous blinks. */
  maxNaturalBlinkMs: number;
  /** Stay "elevated" until no fatigue signs have been seen for this long, so the UI doesn't flap. */
  recoverMs: number;
  /** Downsampling interval for open-eye openness samples. */
  sampleEveryMs: number;
}

export const DEFAULT_FATIGUE: FatigueConfig = {
  baselineMs: 5 * 60_000,
  windowMs: 60_000,
  rateRatio: 1.5,
  minRateIncrease: 5,
  durationRatio: 1.5,
  opennessRatio: 0.85,
  maxNaturalBlinkMs: 500,
  recoverMs: 30_000,
  sampleEveryMs: 100,
};

export type FatigueLevel = "baseline" | "normal" | "elevated";

export interface FatigueStats {
  blinksPerMin: number;
  meanBlinkMs: number;
  openness: number;
}

export interface FatigueSnapshot extends FatigueStats {
  level: FatigueLevel;
  baseline: FatigueStats | null;
  /** Time left before the baseline is set; 0 afterwards. */
  baselineRemainingMs: number;
  reasons: string[];
}

export interface FatigueEvent {
  type: "fatigue";
  t: number;
  level: "normal" | "elevated";
  reasons: string[];
}

/**
 * Wellness-style fatigue signal from the patient's own baseline: blink rate, blink duration and
 * open-eye openness (an eyelid-droop proxy). It drives UI pacing only; it is not a clinical measure.
 */
export class FatigueMonitor {
  private start: number | null = null;
  private blinks: { t: number; durationMs: number }[] = [];
  private samples: { t: number; v: number }[] = [];
  private baseline: FatigueStats | null = null;
  private level: FatigueLevel = "baseline";
  private lastReasonT = -Infinity;

  constructor(readonly cfg: FatigueConfig = { ...DEFAULT_FATIGUE }) {}

  addBlink(t: number, durationMs: number): void {
    if (durationMs <= this.cfg.maxNaturalBlinkMs) this.blinks.push({ t, durationMs });
  }

  /** Feed openness only while the eyes are open. */
  addOpenSample(t: number, openness: number): void {
    const last = this.samples.at(-1);
    if (!last || t - last.t >= this.cfg.sampleEveryMs) this.samples.push({ t, v: openness });
  }

  update(t: number): { snapshot: FatigueSnapshot; events: FatigueEvent[] } {
    const events: FatigueEvent[] = [];
    this.start ??= t;
    const elapsed = t - this.start;

    if (!this.baseline) {
      if (elapsed < this.cfg.baselineMs) {
        return { snapshot: this.snapshot(this.measure(t, elapsed), [], this.cfg.baselineMs - elapsed), events };
      }
      this.baseline = this.measure(t, elapsed);
      this.level = "normal";
    }

    const cutoff = t - this.cfg.windowMs;
    while (this.blinks.length && this.blinks[0].t <= cutoff) this.blinks.shift();
    while (this.samples.length && this.samples[0].t <= cutoff) this.samples.shift();

    const cur = this.measure(t, Math.min(this.cfg.windowMs, elapsed));
    const reasons = this.reasons(cur, this.baseline);
    if (reasons.length) this.lastReasonT = t;

    const next: FatigueLevel = reasons.length ? "elevated" : t - this.lastReasonT >= this.cfg.recoverMs ? "normal" : this.level;
    if (next !== this.level) {
      this.level = next;
      events.push({ type: "fatigue", t, level: next as "normal" | "elevated", reasons });
    }
    return { snapshot: this.snapshot(cur, reasons, 0), events };
  }

  private measure(t: number, spanMs: number): FatigueStats {
    const from = t - spanMs;
    const blinks = this.blinks.filter((b) => b.t > from);
    return {
      blinksPerMin: spanMs > 0 ? blinks.length / (spanMs / 60_000) : NaN,
      meanBlinkMs: mean(blinks.map((b) => b.durationMs)),
      openness: median(this.samples.filter((s) => s.t > from).map((s) => s.v)),
    };
  }

  private reasons(cur: FatigueStats, base: FatigueStats): string[] {
    const out: string[] = [];
    const c = this.cfg;
    if (cur.blinksPerMin >= Math.max(base.blinksPerMin * c.rateRatio, base.blinksPerMin + c.minRateIncrease)) {
      out.push("blink rate up");
    }
    if (cur.meanBlinkMs >= base.meanBlinkMs * c.durationRatio) out.push("longer blinks");
    if (cur.openness <= base.openness * c.opennessRatio) out.push("eyelids lower");
    return out; // NaN comparisons are false, so missing data never raises fatigue
  }

  private snapshot(cur: FatigueStats, reasons: string[], baselineRemainingMs: number): FatigueSnapshot {
    return { ...cur, level: this.level, baseline: this.baseline, baselineRemainingMs, reasons };
  }
}
