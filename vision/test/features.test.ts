import { describe, expect, it } from "vitest";
import { extractEyeFrame, eyeAspectRatio, irisRatio, irisVertical, LEFT_EYE_EAR, RIGHT_EYE_EAR } from "../src/cv/features";
import type { Point } from "../src/cv/types";

function face(): Point[] {
  return Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
}

/** Places a six-point eye with EAR = halfH / halfW (in unscaled units). */
function setEye(lm: Point[], idx: readonly number[], cx: number, cy: number, halfW: number, halfH: number): void {
  const [p1, p2, p3, p4, p5, p6] = idx;
  lm[p1] = { x: cx - halfW, y: cy };
  lm[p4] = { x: cx + halfW, y: cy };
  lm[p2] = { x: cx - halfW / 3, y: cy - halfH };
  lm[p3] = { x: cx + halfW / 3, y: cy - halfH };
  lm[p6] = { x: cx - halfW / 3, y: cy + halfH };
  lm[p5] = { x: cx + halfW / 3, y: cy + halfH };
}

describe("eyeAspectRatio", () => {
  it("is lid opening over eye width", () => {
    const lm = face();
    setEye(lm, RIGHT_EYE_EAR, 0.4, 0.5, 0.05, 0.015);
    expect(eyeAspectRatio(lm, RIGHT_EYE_EAR, 1, 1)).toBeCloseTo(0.3);
  });

  it("measures in pixels, not normalized units", () => {
    const lm = face();
    setEye(lm, RIGHT_EYE_EAR, 0.4, 0.5, 0.05, 0.015);
    expect(eyeAspectRatio(lm, RIGHT_EYE_EAR, 1280, 720)).toBeCloseTo((0.3 * 720) / 1280);
  });
});

describe("irisRatio", () => {
  it("is 0 at the image-left corner and 1 at the image-right one, whatever the corner order", () => {
    const lm = face();
    setEye(lm, RIGHT_EYE_EAR, 0.4, 0.5, 0.05, 0.015);
    lm[468] = { x: 0.375, y: 0.5 };
    expect(irisRatio(lm, 33, 133, 468, 1, 1)).toBeCloseTo(0.25);
    expect(irisRatio(lm, 133, 33, 468, 1, 1)).toBeCloseTo(0.25);
  });
});

describe("irisVertical", () => {
  it("is the offset below the corner line in eye widths, whatever the corner order", () => {
    const lm = face();
    setEye(lm, RIGHT_EYE_EAR, 0.4, 0.5, 0.05, 0.015);
    lm[468] = { x: 0.4, y: 0.51 };
    expect(irisVertical(lm, 33, 133, 468, 1, 1)).toBeCloseTo(0.1);
    expect(irisVertical(lm, 133, 33, 468, 1, 1)).toBeCloseTo(0.1);
    lm[468] = { x: 0.4, y: 0.49 };
    expect(irisVertical(lm, 33, 133, 468, 1, 1)).toBeCloseTo(-0.1);
  });
});

describe("extractEyeFrame", () => {
  it("combines blendshape look directions", () => {
    const lm = face();
    setEye(lm, RIGHT_EYE_EAR, 0.4, 0.5, 0.05, 0.015);
    setEye(lm, LEFT_EYE_EAR, 0.6, 0.5, 0.05, 0.015);
    const bs = (name: string, score: number) => ({ categoryName: name, score });
    const f = extractEyeFrame(0, lm, [
      bs("eyeLookOutLeft", 0.6), bs("eyeLookInRight", 0.4), bs("eyeLookInLeft", 0), bs("eyeLookOutRight", 0),
      bs("eyeLookDownLeft", 0.5), bs("eyeLookDownRight", 0.3), bs("eyeLookUpLeft", 0), bs("eyeLookUpRight", 0),
    ], 1, 1);
    expect(f.lookX).toBeCloseTo(0.5);
    expect(f.lookY).toBeCloseTo(0.4);
    expect(extractEyeFrame(0, lm, undefined, 1, 1).lookY).toBeNaN();
  });

  it("reports no face without a full landmark set", () => {
    const f = extractEyeFrame(10, undefined, undefined, 640, 480);
    expect(f.faceFound).toBe(false);
    expect(f.ear).toBeNaN();
    expect(extractEyeFrame(10, face().slice(0, 468), undefined, 640, 480).faceFound).toBe(false);
  });

  it("averages both eyes and the squint scores", () => {
    const lm = face();
    setEye(lm, RIGHT_EYE_EAR, 0.4, 0.5, 0.05, 0.015);
    setEye(lm, LEFT_EYE_EAR, 0.6, 0.5, 0.05, 0.005);
    lm[468] = { x: 0.4, y: 0.5 };
    lm[473] = { x: 0.6, y: 0.5 };
    const f = extractEyeFrame(0, lm, [
      { categoryName: "eyeSquintLeft", score: 0.2 },
      { categoryName: "eyeSquintRight", score: 0.4 },
    ], 1, 1);
    expect(f.faceFound).toBe(true);
    expect(f.ear).toBeCloseTo(0.2);
    expect(f.gazeX).toBeCloseTo(0.5);
    expect(f.squint).toBeCloseTo(0.3);
  });
});
