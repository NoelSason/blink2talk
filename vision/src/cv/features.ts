import type { EyeFrame, Point } from "./types";

// Six-point EAR order: p1 and p4 are the eye corners; (p2, p6) and (p3, p5) are upper/lower lid pairs.
// "Right"/"left" are the subject's own eyes (MediaPipe convention). In an unmirrored image the
// subject's right eye is on the image's left, which is why the report lists 33… as "left".
export const RIGHT_EYE_EAR = [33, 160, 158, 133, 153, 144] as const;
export const LEFT_EYE_EAR = [362, 385, 387, 263, 373, 380] as const;
export const RIGHT_IRIS_CENTER = 468;
export const LEFT_IRIS_CENTER = 473;

export const EYE_DRAW_POINTS: readonly number[] = [...RIGHT_EYE_EAR, ...LEFT_EYE_EAR];
export const IRIS_CENTERS: readonly number[] = [RIGHT_IRIS_CENTER, LEFT_IRIS_CENTER];

// Landmarks are normalized separately on each axis, so distances must be taken in pixels.
function dist(a: Point, b: Point, w: number, h: number): number {
  return Math.hypot((a.x - b.x) * w, (a.y - b.y) * h);
}

/** Eye Aspect Ratio (Soukupová & Čech 2016): mean lid opening divided by eye width. */
export function eyeAspectRatio(lm: readonly Point[], idx: readonly number[], w: number, h: number): number {
  const [p1, p2, p3, p4, p5, p6] = idx.map((i) => lm[i]);
  const width = dist(p1, p4, w, h);
  return width > 0 ? (dist(p2, p6, w, h) + dist(p3, p5, w, h)) / (2 * width) : 0;
}

/**
 * Iris center projected onto the corner-to-corner axis: 0 at the image-left corner, 1 at the image-right one.
 * Projecting (rather than using x alone) keeps the ratio stable when the head is tilted.
 */
export function irisRatio(lm: readonly Point[], cornerA: number, cornerB: number, iris: number, w: number, h: number): number {
  const [l, r] = lm[cornerA].x <= lm[cornerB].x ? [lm[cornerA], lm[cornerB]] : [lm[cornerB], lm[cornerA]];
  const c = lm[iris];
  const vx = (r.x - l.x) * w;
  const vy = (r.y - l.y) * h;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return 0.5;
  return ((c.x - l.x) * w * vx + (c.y - l.y) * h * vy) / len2;
}

/**
 * Iris offset perpendicular to the corner-to-corner line, in eye widths; positive = below the line.
 * Divided by eye width rather than eye height because the lids move with vertical gaze.
 */
export function irisVertical(lm: readonly Point[], cornerA: number, cornerB: number, iris: number, w: number, h: number): number {
  const a = lm[cornerA];
  const b = lm[cornerB];
  const c = lm[iris];
  const vx = (b.x - a.x) * w;
  const vy = (b.y - a.y) * h;
  const len = Math.hypot(vx, vy);
  if (len === 0) return 0;
  // Unit normal pointing down the image, whichever corner is passed first.
  let nx = -vy / len;
  let ny = vx / len;
  if (ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  const mx = ((a.x + b.x) / 2) * w;
  const my = ((a.y + b.y) / 2) * h;
  return ((c.x * w - mx) * nx + (c.y * h - my) * ny) / len;
}

export interface Blendshape {
  categoryName: string;
  score: number;
}

function score(blendshapes: readonly Blendshape[] | undefined, name: string): number {
  return blendshapes?.find((b) => b.categoryName === name)?.score ?? NaN;
}

export function extractEyeFrame(
  t: number,
  landmarks: readonly Point[] | undefined,
  blendshapes: readonly Blendshape[] | undefined,
  width: number,
  height: number,
): EyeFrame {
  // 478 = 468 face points + 10 iris points; fewer means the model ran without iris refinement.
  if (!landmarks || landmarks.length < 478) {
    return { t, faceFound: false, ear: NaN, gazeX: NaN, gazeY: NaN, lookX: NaN, lookY: NaN, squint: NaN };
  }
  const lm = landmarks;
  const ear = (eyeAspectRatio(lm, RIGHT_EYE_EAR, width, height) + eyeAspectRatio(lm, LEFT_EYE_EAR, width, height)) / 2;
  const gazeX =
    (irisRatio(lm, 33, 133, RIGHT_IRIS_CENTER, width, height) + irisRatio(lm, 362, 263, LEFT_IRIS_CENTER, width, height)) / 2;
  const gazeY =
    (irisVertical(lm, 33, 133, RIGHT_IRIS_CENTER, width, height) +
      irisVertical(lm, 362, 263, LEFT_IRIS_CENTER, width, height)) /
    2;

  // Missing blendshapes give NaN, which propagates through the arithmetic below.
  const s = (name: string) => score(blendshapes, name);
  // Looking toward one side turns one eye "out" and the other "in"; the pairing holds whichever way MediaPipe names sides.
  const lookX = (s("eyeLookOutLeft") + s("eyeLookInRight") - s("eyeLookInLeft") - s("eyeLookOutRight")) / 2;
  const lookY = (s("eyeLookDownLeft") + s("eyeLookDownRight") - s("eyeLookUpLeft") - s("eyeLookUpRight")) / 2;
  const squint = (s("eyeSquintLeft") + s("eyeSquintRight")) / 2;

  return { t, faceFound: true, ear, gazeX, gazeY, lookX, lookY, squint };
}
