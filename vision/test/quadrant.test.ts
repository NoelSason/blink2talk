import { describe, expect, it } from "vitest";
import { Calibrator } from "../src/cv/calibration";
import { EyePipeline } from "../src/cv/pipeline";
import {
  featureVector,
  fitQuadrants,
  nearestTarget,
  QUADRANT_TARGETS,
  QuadrantClassifier,
  TARGET_POSITIONS,
  type QuadrantEvent,
  type QuadrantTarget,
} from "../src/cv/quadrant";
import type { EyeFrame } from "../src/cv/types";

const FRAME = 1000 / 30;

let seed = 1;
const noise = (amp: number) => {
  seed = (seed * 16807) % 2147483647;
  return ((seed / 2147483647) * 2 - 1) * amp;
};

/**
 * Synthetic user looking at area point (x, y): features are linear in the point plus noise, with
 * weaker vertical gain (as on a real webcam), and the eyes narrow when looking down.
 */
function frame(t: number, x: number, y: number, opts: { ear?: number; squint?: number } = {}): EyeFrame {
  return {
    t,
    faceFound: true,
    ear: opts.ear ?? 0.3 - 0.05 * Math.max(0, y) + noise(0.01),
    gazeX: 0.5 + 0.08 * x + noise(0.006),
    gazeY: 0.03 * y + noise(0.004),
    lookX: 0.4 * x + noise(0.05),
    lookY: 0.25 * y + noise(0.05),
    squint: opts.squint ?? 0.1 + noise(0.02),
  };
}

const at = (k: QuadrantTarget, t = 0) => frame(t, ...TARGET_POSITIONS[k]);

function samples(n = 45): Record<QuadrantTarget, EyeFrame[]> {
  return Object.fromEntries(QUADRANT_TARGETS.map((k) => [k, Array.from({ length: n }, (_, i) => at(k, i * FRAME))])) as Record<
    QuadrantTarget,
    EyeFrame[]
  >;
}

describe("fitQuadrants", () => {
  const cal = fitQuadrants(samples())!;

  it("uses every available feature and separates the box-center looks", () => {
    expect(cal.dims).toEqual(["gazeX", "gazeY", "lookX", "lookY"]);
    for (const k of QUADRANT_TARGETS) expect(cal.accuracy[k]).toBeGreaterThan(0.95);
  });

  it("drops features missing for any target", () => {
    const s = samples();
    for (const k of QUADRANT_TARGETS) s[k] = s[k].map((f) => ({ ...f, lookX: NaN, lookY: NaN }));
    expect(fitQuadrants(s)!.dims).toEqual(["gazeX", "gazeY"]);
  });

  it("returns null with no usable features", () => {
    const s = samples();
    for (const k of QUADRANT_TARGETS) s[k] = s[k].map((f) => ({ ...f, gazeX: NaN, gazeY: NaN, lookX: NaN, lookY: NaN }));
    expect(fitQuadrants(s)).toBeNull();
  });

  it("stays with the current target near a boundary (hysteresis)", () => {
    const halfway = featureVector(frame(0, 0.27, -0.27), cal.dims); // slightly nearer topRight than center
    expect(nearestTarget(cal, halfway, "center", 10)).toBe("center");
    expect(nearestTarget(cal, featureVector(at("topRight"), cal.dims), "center", 0.5)).toBe("topRight");
  });
});

describe("QuadrantClassifier", () => {
  const cal = fitQuadrants(samples())!;

  function run(segments: [QuadrantTarget, number, boolean?][]): QuadrantEvent[] {
    const c = new QuadrantClassifier(cal);
    const events: QuadrantEvent[] = [];
    let t = 0;
    for (const [k, ms, frozen = false] of segments) {
      for (const end = t + ms; t < end; t += FRAME) events.push(...c.update(t, at(k, t), frozen).events);
    }
    return events;
  }

  it("focuses a box after the dwell, and only once", () => {
    expect(run([["center", 300], ["bottomRight", 1500]]).map((e) => e.quadrant)).toEqual(["bottomRight"]);
  });

  it("ignores a quick glance at another box", () => {
    expect(run([["center", 300], ["topLeft", 1000], ["topRight", 150], ["topLeft", 1000]]).map((e) => e.quadrant)).toEqual(["topLeft"]);
  });

  it("clears the focus when the user settles on the rest circle", () => {
    expect(run([["center", 300], ["topLeft", 800], ["center", 800]]).map((e) => e.quadrant)).toEqual(["topLeft", null]);
  });

  it("freezes during a hold", () => {
    expect(run([["center", 300], ["topLeft", 800], ["bottomLeft", 1000, true]]).map((e) => e.quadrant)).toEqual(["topLeft"]);
  });
});

describe("box-center calibration and selection", () => {
  /** Runs a pipeline through calibration with a user who follows the prompts. */
  function calibrated(): { p: EyePipeline; t: number } {
    const p = new EyePipeline({ calibration: { layout: "quadrants" } });
    p.startCalibration();
    const cal = new Calibrator(p.cfg.calibration); // mirrors the pipeline's phase sequence
    let t = 0;
    while (p.mode === "calibrating") {
      const phase = cal.phase;
      const target: QuadrantTarget = phase === "ready" || phase === "squint" || phase === "done" ? "center" : (phase as QuadrantTarget);
      const f = phase === "squint" ? frame(t, 0, 0, { ear: 0.22, squint: 0.6 }) : at(target, t);
      cal.add(f);
      p.process(f);
      t += FRAME;
    }
    return { p, t };
  }

  it("counts down 3 s, then takes 2 s per dot", () => {
    const c = new Calibrator({ ...new EyePipeline().cfg.calibration, layout: "quadrants" });
    const first = c.add(at("center", 0));
    expect(first).toMatchObject({ phase: "ready", remainingMs: 3000 });
    expect(c.add(at("center", 1500)).remainingMs).toBe(1500);
    expect(c.add(at("center", 3000)).phase).toBe("center");
    expect(c.totalMs).toBe(15_000);
  });

  it("calibrates without warnings", () => {
    const { p, t } = calibrated();
    expect(t).toBeLessThan(15_200);
    expect(p.calibration?.quadrants).not.toBeNull();
    expect(p.calibration?.squint?.feature).toBe("squint");
    expect(p.calibration?.warnings).toEqual([]);
  });

  it("selects the focused box by long blink or squint, nothing from the rest circle, and nothing for a normal look down", () => {
    let { p, t } = calibrated();
    const selects: [string | null, string][] = [];
    const feed = (k: QuadrantTarget, ms: number, opts: { ear?: number; squint?: number; y?: number } = {}) => {
      const [x, y] = TARGET_POSITIONS[k];
      for (const end = t + ms; t < end; t += FRAME) {
        for (const e of p.process(frame(t, x, opts.y ?? y, opts)).events) if (e.type === "quadrantSelect") selects.push([e.quadrant, e.via]);
      }
    };
    feed("center", 500);
    feed("topRight", 800); // read the top-right box
    feed("topRight", 1000, { ear: 0.05, y: 0.9 }); // long blink; lids drag gaze down, but the box was chosen at hold start
    feed("topRight", 500);
    feed("center", 2000);
    feed("center", 1000, { ear: 0.05 }); // long blink in the rest circle
    feed("center", 500);
    feed("bottomLeft", 3000); // read the bottom-left box: narrower eyes, but no squint
    feed("bottomLeft", 1200, { squint: 0.6 }); // held squint
    feed("bottomLeft", 500);
    expect(selects).toEqual([
      ["topRight", "blink"],
      [null, "blink"],
      ["bottomLeft", "squint"],
    ]);
  });
});
