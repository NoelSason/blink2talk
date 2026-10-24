import type { EyePipeline, PipelineOutput } from "./pipeline";
import type { FaceTracker } from "./tracker";
import type { Point } from "./types";

export interface EyeInputOptions {
  video: HTMLVideoElement;
  tracker: FaceTracker;
  pipeline: EyePipeline;
  onFrame: (out: PipelineOutput, landmarks?: Point[]) => void;
}

/** Runs tracker → pipeline once per new video frame. */
export class EyeInput {
  private raf = 0;
  private lastVideoTime = -1;

  constructor(private readonly opts: EyeInputOptions) {}

  start(): void {
    this.stop();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      const { video, tracker, pipeline, onFrame } = this.opts;
      // rAF runs at display rate (often 60 Hz) but the camera delivers ~30 fps; skip repeated frames.
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.currentTime === this.lastVideoTime) return;
      this.lastVideoTime = video.currentTime;
      const { frame, landmarks } = tracker.detect(video, performance.now());
      onFrame(pipeline.process(frame), landmarks);
    };
    loop();
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}

export async function openWebcam(
  video: HTMLVideoElement,
  constraints: MediaTrackConstraints = { width: 1280, height: 720, frameRate: 30 },
): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false });
  video.srcObject = stream;
  video.muted = true;
  await video.play();
  return stream;
}
