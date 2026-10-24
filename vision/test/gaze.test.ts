import { describe, expect, it } from "vitest";
import { GazeClassifier, type GazeCalibration, type GazeEvent } from "../src/cv/gaze";

const CAL: GazeCalibration = { left: 0.4, center: 0.5, right: 0.6 };
const FRAME = 1000 / 30;

/** Feeds constant-ratio segments at 30 fps; `closed` marks eyes shut. */
function run(g: GazeClassifier, segments: [ratio: number, ms: number, closed?: boolean][]): GazeEvent[] {
  const events: GazeEvent[] = [];
  let t = 0;
  for (const [ratio, ms, closed = false] of segments) {
    const end = t + ms;
    for (; t < end; t += FRAME) events.push(...g.update(t, ratio, closed).events);
  }
  return events;
}

describe("GazeClassifier", () => {
  it("classifies by nearest calibration target", () => {
    const g = new GazeClassifier(CAL);
    expect(g.classify(0.41)).toBe("left");
    expect(g.classify(0.52)).toBe("center");
    expect(g.classify(0.7)).toBe("right");
  });

  it("fires once after the dwell time", () => {
    const es = run(new GazeClassifier(CAL), [[0.5, 300], [0.6, 1500]]);
    expect(es).toHaveLength(1);
    expect(es[0].direction).toBe("right");
    expect(es[0].t - 300).toBeGreaterThanOrEqual(700);
  });

  it("ignores a short glance", () => {
    expect(run(new GazeClassifier(CAL), [[0.5, 300], [0.6, 400], [0.5, 500]])).toHaveLength(0);
  });

  it("re-arms after looking back to center", () => {
    const es = run(new GazeClassifier(CAL), [[0.5, 300], [0.6, 1000], [0.5, 500], [0.6, 1000]]);
    expect(es.map((e) => e.direction)).toEqual(["right", "right"]);
  });

  it("pauses the dwell timer during a blink instead of resetting it", () => {
    const es = run(new GazeClassifier(CAL), [[0.5, 300], [0.4, 450], [NaN, 300, true], [0.4, 450]]);
    expect(es.map((e) => e.direction)).toEqual(["left"]);
  });

  it("does not re-fire when the look dips briefly toward center", () => {
    const es = run(new GazeClassifier(CAL), [[0.5, 300], [0.6, 1000], [0.5, 150], [0.6, 1000]]);
    expect(es).toHaveLength(1);
  });

  it("holds the current direction near a boundary (hysteresis)", () => {
    const g = new GazeClassifier(CAL);
    expect(g.classify(0.555, "center")).toBe("center");
    expect(g.classify(0.555)).toBe("right");
    expect(g.classify(0.58, "center")).toBe("right");
  });

  it("never fires while looking at center with noise", () => {
    const g = new GazeClassifier(CAL);
    const events: GazeEvent[] = [];
    for (let i = 0, t = 0; i < 300; i++, t += FRAME) events.push(...g.update(t, 0.5 + 0.04 * Math.sin(i * 1.7), false).events);
    expect(events).toEqual([]);
  });

  it("works with a mirrored camera, since direction comes from the calibration labels", () => {
    const mirrored = new GazeClassifier({ left: 0.6, center: 0.5, right: 0.4 });
    expect(run(mirrored, [[0.5, 300], [0.6, 1000]]).map((e) => e.direction)).toEqual(["left"]);
  });
});
