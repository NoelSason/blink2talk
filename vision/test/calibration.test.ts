import { describe, expect, it } from "vitest";
import { Calibrator, DEFAULT_CALIBRATION, type CalibrationPhase } from "../src/cv/calibration";
import { EyePipeline } from "../src/cv/pipeline";
import type { EyeFrame } from "../src/cv/types";

const FRAME = 1000 / 30;

export function frame(t: number, ear: number, gazeX: number, squint = 0.1, faceFound = true): EyeFrame {
  const rest = { gazeY: NaN, lookX: NaN, lookY: NaN };
  return faceFound
    ? { t, faceFound, ear, gazeX, squint, ...rest }
    : { t, faceFound, ear: NaN, gazeX: NaN, squint: NaN, ...rest };
}

/** Simulated user following the prompts, with a natural blink every 3 s. */
function user(gaze: { center: number; left: number; right: number }, squintFace = { ear: 0.2, squint: 0.6 }, faceFound = true) {
  return (t: number, phase: CalibrationPhase): EyeFrame => {
    const blinking = t % 3000 < 200;
    if (phase === "squint") return frame(t, blinking ? 0.08 : squintFace.ear, gaze.center, squintFace.squint, faceFound);
    const g = phase === "left" || phase === "right" ? gaze[phase] : gaze.center;
    return frame(t, blinking ? 0.08 : 0.3, g, 0.1, faceFound);
  };
}

function calibrate(c: Calibrator, make: (t: number, phase: CalibrationPhase) => EyeFrame): number {
  let t = 0;
  while (c.phase !== "done" && t < 60_000) {
    c.add(make(t, c.phase));
    t += FRAME;
  }
  return t;
}

describe("Calibrator", () => {
  it("derives blink thresholds, gaze targets and squint in ~15 s", () => {
    const c = new Calibrator();
    const t = calibrate(c, user({ center: 0.5, left: 0.42, right: 0.58 }));
    expect(t).toBeGreaterThan(14_900);
    expect(t).toBeLessThan(15_200);

    const r = c.result();
    expect(r.openBaseline).toBeCloseTo(0.3);
    expect(r.thresholds.close).toBeCloseTo(0.195);
    expect(r.thresholds.open).toBeCloseTo(0.245);
    expect(r.gaze).toEqual({ left: 0.42, center: 0.5, right: 0.58 });
    expect(r.squint?.feature).toBe("squint");
    expect(r.warnings).toEqual([]);
  });

  it("turns gaze off when left and right looks are too similar", () => {
    const c = new Calibrator();
    calibrate(c, user({ center: 0.5, left: 0.49, right: 0.51 }));
    const r = c.result();
    expect(r.gaze).toBeNull();
    expect(r.warnings).toEqual([expect.stringMatching(/Left and right/)]);
  });

  it("turns squint off when it looks like a normal look", () => {
    const c = new Calibrator();
    calibrate(c, user({ center: 0.5, left: 0.42, right: 0.58 }, { ear: 0.3, squint: 0.1 }));
    const r = c.result();
    expect(r.squint).toBeNull();
    expect(r.warnings).toEqual([expect.stringMatching(/Squint/)]);
  });

  it("fails without a face", () => {
    const c = new Calibrator();
    calibrate(c, user({ center: 0.5, left: 0.42, right: 0.58 }, undefined, false));
    expect(() => c.result()).toThrow(/not visible/);
  });
});

describe("EyePipeline", () => {
  it("calibrates, then turns a long blink and a held squint into selects", () => {
    const p = new EyePipeline();
    p.startCalibration();
    const cal = new Calibrator(p.cfg.calibration);
    const make = user({ center: 0.5, left: 0.42, right: 0.58 });
    const events: { type: string; via?: string }[] = [];
    let t = 0;
    while (p.mode === "calibrating") {
      const f = make(t, cal.phase); // `cal` mirrors the pipeline's phase sequence
      cal.add(f);
      events.push(...p.process(f).events);
      t += FRAME;
    }
    expect(events.map((e) => e.type)).toContain("calibrated");

    const feed = (ear: number, ms: number, squint = 0.1) => {
      for (const end = t + ms; t < end; t += FRAME) events.push(...p.process(frame(t, ear, 0.5, squint)).events);
    };
    feed(0.3, 500);
    feed(0.08, 1000); // long blink
    feed(0.3, 1500);
    feed(0.3, 1000, 0.6); // held squint, eyes still open
    feed(0.3, 500);
    expect(events.filter((e) => e.type === "select").map((e) => e.via)).toEqual(["blink", "squint"]);
  });
});

describe("lead-in before the squint", () => {
  it("shows the countdown first and takes no samples during it", () => {
    const c = new Calibrator({ ...DEFAULT_CALIBRATION, layout: "quadrants", readyMs: 0, leadMs: 1000, phaseMs: 1000, settleMs: 0 });
    const leads: boolean[] = [];
    let t = 0;
    let sawLead = false;
    while (c.phase !== "done" && t < 60_000) {
      const phase = c.phase;
      const p = c.add(frame(t, 0.3, 0, 0.1, true));
      if (phase === "squint" && p.leadRemainingMs !== undefined) {
        sawLead = true;
        leads.push(p.leadRemainingMs > 0);
      }
      t += FRAME;
    }
    expect(sawLead).toBe(true);
    expect(leads.every(Boolean)).toBe(true);
    expect(c.totalMs).toBe(6 * 1000 + 1000);
    expect(c.phase).toBe("done");
  });

  it("with no lead-in, behaves as before", () => {
    const c = new Calibrator({ ...DEFAULT_CALIBRATION, layout: "quadrants", readyMs: 0, leadMs: 0, phaseMs: 1000, settleMs: 0 });
    const p = c.add(frame(0, 0.3, 0));
    expect(p.leadRemainingMs).toBeUndefined();
  });
});
