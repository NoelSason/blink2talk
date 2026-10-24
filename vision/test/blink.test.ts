import { describe, expect, it } from "vitest";
import { BlinkDetector, type BlinkEvent } from "../src/cv/blink";

const OPEN = 0.3;
const CLOSED = 0.1;
const FRAME = 1000 / 30;

/** Feeds constant segments at 30 fps: [EAR, ms, squinting?]. */
function run(segments: [ear: number, ms: number, squint?: boolean][], det = new BlinkDetector({ close: 0.2, open: 0.25 })): BlinkEvent[] {
  const events: BlinkEvent[] = [];
  let t = 0;
  for (const [ear, ms, squint = false] of segments) {
    for (const end = t + ms; t < end; t += FRAME) events.push(...det.update(t, ear, squint).events);
  }
  return events;
}

const types = (es: BlinkEvent[]) => es.map((e) => e.type);
const selects = (es: BlinkEvent[]) => es.filter((e): e is Extract<BlinkEvent, { type: "select" }> => e.type === "select");

describe("BlinkDetector", () => {
  it("reports a natural blink without selecting", () => {
    const es = run([[OPEN, 500], [CLOSED, 200], [OPEN, 500]]);
    expect(types(es)).toEqual(["holdStart", "blink"]);
    const blink = es[1] as Extract<BlinkEvent, { type: "blink" }>;
    expect(blink.durationMs).toBeGreaterThan(150);
    expect(blink.durationMs).toBeLessThan(250);
  });

  it("ignores a single-frame glitch", () => {
    expect(run([[OPEN, 500], [CLOSED, FRAME], [OPEN, 500]])).toEqual([]);
  });

  it("selects when a long blink is released", () => {
    const es = run([[OPEN, 500], [CLOSED, 1000], [OPEN, 300]]);
    expect(types(es)).toEqual(["holdStart", "select"]);
    expect(es[1].t).toBeGreaterThanOrEqual(1500);
    expect(selects(es)[0].via).toBe("blink");
  });

  it("does not select when the eyes open before selectMs (abort)", () => {
    expect(types(run([[OPEN, 500], [CLOSED, 600], [OPEN, 300]]))).toEqual(["holdStart", "blink"]);
  });

  it("blocks a second select inside the refractory period", () => {
    expect(selects(run([[OPEN, 500], [CLOSED, 1000], [OPEN, 300], [CLOSED, 1000], [OPEN, 300]]))).toHaveLength(1);
  });

  it("allows a second select after the refractory period", () => {
    expect(selects(run([[OPEN, 500], [CLOSED, 1000], [OPEN, 1500], [CLOSED, 1000], [OPEN, 300]]))).toHaveLength(2);
  });

  it("treats a 3 s closure as rest, not select", () => {
    expect(types(run([[OPEN, 500], [CLOSED, 3500], [OPEN, 300]]))).toEqual(["holdStart", "rest", "restEnd"]);
  });

  it("drops a hold when the face is lost", () => {
    expect(types(run([[OPEN, 500], [CLOSED, 500], [NaN, 500], [OPEN, 300]]))).toEqual(["holdStart"]);
  });

  it("reports fill progress during a hold", () => {
    const det = new BlinkDetector({ close: 0.2, open: 0.25 });
    run([[OPEN, 500], [CLOSED, 400]], det);
    const { state } = det.update(1000, CLOSED);
    expect(state.engaged).toBe(true);
    expect(state.progress).toBeGreaterThan(0.4);
    expect(state.progress).toBeLessThan(0.7);
  });

  it("selects on a held squint with the eyes still open", () => {
    const es = run([[OPEN, 500], [OPEN, 1000, true], [OPEN, 300]]);
    expect(types(es)).toEqual(["holdStart", "select"]);
    expect(selects(es)[0].via).toBe("squint");
  });

  it("ignores a short squint, and never counts it as a blink", () => {
    expect(types(run([[OPEN, 500], [OPEN, 400, true], [OPEN, 300]]))).toEqual(["holdStart"]);
  });

  it("counts a squint that deepens into a closure as one blink hold", () => {
    const es = run([[OPEN, 500], [OPEN, 400, true], [CLOSED, 600, true], [OPEN, 300]]);
    expect(types(es)).toEqual(["holdStart", "select"]);
    expect(selects(es)[0].via).toBe("blink");
  });

  it("does not rest on a long squint", () => {
    expect(types(run([[OPEN, 500], [OPEN, 3500, true], [OPEN, 300]]))).toEqual(["holdStart", "select"]);
  });
});
