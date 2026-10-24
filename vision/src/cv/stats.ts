export function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function mean(values: readonly number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN;
}

/** Median absolute deviation scaled to σ; ignores the few blink frames that land in calibration samples. */
export function robustSpread(values: readonly number[]): number {
  const c = median(values);
  return 1.4826 * median(values.map((v) => Math.abs(v - c)));
}

/** Sliding-window median. Drops single-frame landmark glitches without smearing real transitions. */
export class MedianFilter {
  private buf: number[] = [];

  constructor(private readonly size: number) {}

  push(v: number): number {
    this.buf.push(v);
    if (this.buf.length > this.size) this.buf.shift();
    return median(this.buf);
  }

  reset(): void {
    this.buf = [];
  }
}
