import { describe, expect, it } from "vitest";
import { DEFAULT_FATIGUE, FatigueMonitor, type FatigueEvent } from "../src/cv/fatigue";

const cfg = { ...DEFAULT_FATIGUE, baselineMs: 60_000, windowMs: 60_000 };
const STEP = 100;

interface Phase {
  ms: number;
  /** Seconds between blinks. */
  every: number;
  blinkMs?: number;
  openness?: number;
}

function run(m: FatigueMonitor, phases: Phase[]) {
  const events: FatigueEvent[] = [];
  let t = 0;
  let nextBlink = 0;
  let snapshot = m.update(0).snapshot;
  for (const p of phases) {
    const end = t + p.ms;
    for (; t < end; t += STEP) {
      if (t >= nextBlink) {
        m.addBlink(t, p.blinkMs ?? 200);
        nextBlink = t + p.every * 1000;
      } else m.addOpenSample(t, p.openness ?? 0.3);
      const r = m.update(t);
      events.push(...r.events);
      snapshot = r.snapshot;
    }
  }
  return { events, snapshot };
}

describe("FatigueMonitor", () => {
  it("measures a baseline and stays normal at a steady rate", () => {
    const { events, snapshot } = run(new FatigueMonitor(cfg), [{ ms: 180_000, every: 6 }]);
    expect(events).toEqual([]);
    expect(snapshot.level).toBe("normal");
    expect(snapshot.baseline?.blinksPerMin).toBeCloseTo(10, 0);
  });

  it("reports a baseline countdown first", () => {
    const { snapshot } = run(new FatigueMonitor(cfg), [{ ms: 20_000, every: 6 }]);
    expect(snapshot.level).toBe("baseline");
    expect(snapshot.baselineRemainingMs).toBeGreaterThan(39_000);
  });

  it("flags a rising blink rate", () => {
    const { events } = run(new FatigueMonitor(cfg), [{ ms: 60_000, every: 6 }, { ms: 60_000, every: 2 }]);
    expect(events[0]).toMatchObject({ type: "fatigue", level: "elevated" });
    expect(events[0].reasons).toContain("blink rate up");
  });

  it("flags drooping eyelids", () => {
    const { events } = run(new FatigueMonitor(cfg), [{ ms: 60_000, every: 6 }, { ms: 60_000, every: 6, openness: 0.22 }]);
    expect(events[0].reasons).toContain("eyelids lower");
  });

  it("flags longer blinks", () => {
    const { events } = run(new FatigueMonitor(cfg), [{ ms: 60_000, every: 6 }, { ms: 60_000, every: 6, blinkMs: 400 }]);
    expect(events[0].reasons).toContain("longer blinks");
  });

  it("does not count deliberate long closures as blinks", () => {
    const { events } = run(new FatigueMonitor(cfg), [{ ms: 60_000, every: 6 }, { ms: 60_000, every: 2, blinkMs: 900 }]);
    expect(events).toEqual([]);
  });

  it("returns to normal after recovering", () => {
    const { events } = run(new FatigueMonitor(cfg), [
      { ms: 60_000, every: 6 },
      { ms: 60_000, every: 2 },
      { ms: 120_000, every: 6 },
    ]);
    expect(events.map((e) => e.level)).toEqual(["elevated", "normal"]);
  });
});
