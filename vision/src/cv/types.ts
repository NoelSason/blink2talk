/** A face landmark in MediaPipe's normalized image coordinates (0..1). */
export interface Point {
  x: number;
  y: number;
}

/** Per-frame eye measurements. Everything downstream of the tracker works on these, not on MediaPipe types. */
export interface EyeFrame {
  /** Frame timestamp in ms. */
  t: number;
  faceFound: boolean;
  /** Eye Aspect Ratio averaged over both eyes. Higher = more open; about 0.25–0.35 when open. */
  ear: number;
  /** Iris position between the eye corners, averaged over both eyes. 0 = image-left corner, 1 = image-right corner. */
  gazeX: number;
  /** Iris offset below the corner-to-corner line, in eye widths. Larger = looking lower. */
  gazeY: number;
  /** Blendshape horizontal gaze (eyeLookIn/Out); sign depends on mirroring, calibration handles it. NaN without blendshapes. */
  lookX: number;
  /** Blendshape vertical gaze: eyeLookDown − eyeLookUp. NaN without blendshapes. */
  lookY: number;
  /** Mean eyeSquint blendshape score (0..1). NaN without blendshapes. */
  squint: number;
}
