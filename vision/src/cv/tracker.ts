import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { extractEyeFrame } from "./features";
import type { EyeFrame, Point } from "./types";

export interface FaceTrackerOptions {
  /** URL of the folder holding MediaPipe's WASM files (`npm run assets` copies them to public/mediapipe/wasm). */
  wasmPath: string;
  /** URL of face_landmarker.task (`npm run assets` downloads it to public/models). */
  modelPath: string;
  /** Falls back to CPU automatically if the GPU delegate fails (it can in Electron). */
  delegate?: "GPU" | "CPU";
}

export interface TrackedFrame {
  frame: EyeFrame;
  /** Landmarks of the tracked face, for drawing overlays. */
  landmarks?: Point[];
}

/** Thin wrapper over MediaPipe FaceLandmarker. The model is pretrained; nothing here is trained. */
export class FaceTracker {
  private lastT = -Infinity;

  private constructor(
    private readonly landmarker: FaceLandmarker,
    readonly delegate: "GPU" | "CPU",
  ) {}

  static async create(opts: FaceTrackerOptions): Promise<FaceTracker> {
    const fileset = await FilesetResolver.forVisionTasks(opts.wasmPath);
    const make = (delegate: "GPU" | "CPU") =>
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: opts.modelPath, delegate },
        runningMode: "VIDEO",
        outputFaceBlendshapes: true,
        numFaces: 1,
      });

    const preferred = opts.delegate ?? "GPU";
    try {
      return new FaceTracker(await make(preferred), preferred);
    } catch (err) {
      if (preferred === "CPU") throw err;
      console.warn("MediaPipe GPU delegate failed; falling back to CPU", err);
      return new FaceTracker(await make("CPU"), "CPU");
    }
  }

  detect(source: HTMLVideoElement, t: number): TrackedFrame {
    // VIDEO mode rejects timestamps that don't increase.
    const ts = Math.max(t, this.lastT + 1);
    this.lastT = ts;
    const res = this.landmarker.detectForVideo(source, ts);
    const landmarks = res.faceLandmarks[0];
    const frame = extractEyeFrame(ts, landmarks, res.faceBlendshapes?.[0]?.categories, source.videoWidth, source.videoHeight);
    return { frame, landmarks };
  }

  close(): void {
    this.landmarker.close();
  }
}
