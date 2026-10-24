import { EYE_DRAW_POINTS, FaceTracker, IRIS_CENTERS, openWebcam, type CalibrationLayout, type CalibrationResult, type Point } from "../cv";

export const el = <T extends Element = HTMLElement>(id: string) => document.getElementById(id) as unknown as T;

export function createTracker(): Promise<FaceTracker> {
  return FaceTracker.create({ wasmPath: "/mediapipe/wasm", modelPath: "/models/face_landmarker.task" });
}

/** Owns whatever feeds the <video>: the webcam, or a looped file (mock camera). */
export class VideoSource {
  private stream: MediaStream | null = null;

  constructor(private readonly video: HTMLVideoElement) {}

  async webcam(): Promise<void> {
    this.stop();
    this.stream = await openWebcam(this.video);
  }

  async file(file: File): Promise<void> {
    this.stop();
    this.video.srcObject = null;
    this.video.src = URL.createObjectURL(file);
    this.video.loop = true;
    this.video.muted = true;
    await this.video.play();
  }

  stop(): void {
    this.stream?.getTracks().forEach((tr) => tr.stop());
    this.stream = null;
    if (this.video.src) {
      URL.revokeObjectURL(this.video.src);
      this.video.removeAttribute("src");
    }
  }
}

export function createLog(list: HTMLElement): (text: string) => void {
  const t0 = performance.now();
  return (text) => {
    const li = document.createElement("li");
    const s = Math.floor((performance.now() - t0) / 1000);
    li.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}  ${text}`;
    list.prepend(li);
    while (list.children.length > 100) list.lastChild?.remove();
  };
}

/** Saved calibrations are per page, since the two layouts calibrate different gaze targets. */
export function loadCalibration(key: string, layout: CalibrationLayout): CalibrationResult | null {
  try {
    const raw = localStorage.getItem(key);
    const r = raw ? JSON.parse(raw) : null;
    // Saved shapes from before squint support are rejected so the user recalibrates.
    return r?.layout === layout && "squint" in r && typeof r.thresholds?.close === "number" ? r : null;
  } catch {
    return null;
  }
}

export function saveJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable; the value still applies for this session
  }
}

export function loadJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Eye landmarks and iris centers over the video, in video pixel space. */
export function drawEyeOverlay(canvas: HTMLCanvasElement, video: HTMLVideoElement, landmarks?: Point[]): void {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, w, h);
  if (!landmarks) return;
  const dot = (p: Point, r: number) => {
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, r, 0, Math.PI * 2);
    ctx.fill();
  };
  ctx.fillStyle = "#4ade80";
  EYE_DRAW_POINTS.forEach((i) => dot(landmarks[i], 2.5));
  ctx.fillStyle = "#f472b6";
  IRIS_CENTERS.forEach((i) => dot(landmarks[i], 4));
}

/** Frames per second, reported about once a second. */
export function fpsCounter(): (t: number) => number | null {
  let frames = 0;
  let since = -1;
  return (t) => {
    if (since < 0) since = t;
    frames++;
    const elapsed = t - since;
    if (elapsed < 1000) return null;
    const fps = Math.round((frames * 1000) / elapsed);
    frames = 0;
    since = t;
    return fps;
  };
}
