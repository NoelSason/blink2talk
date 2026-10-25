// WebEyeTrack as an alternative gaze source (dev setting `gazeSource: 'webeyetrack'`). A small neural
// network (BlazeGaze, Vanderbilt 2025, MIT) predicts a point on the screen from an eye-region crop plus
// head pose, and adapts to the person from a few labeled points. It runs in its own Web Worker with its
// own copy of MediaPipe, fed the same camera frames the vision module uses. Blink, squint, rest, and
// fatigue still come from the vision module; only "which box" comes from here.
//
// Bundle: renderer/vendor/webeyetrack.js (made by scripts/webeyetrack.mjs). Weights: renderer/web/.

const MAX_FPS = 15;

// The bundle is UMD: loaded as a classic script it puts WebEyeTrackProxy and friends on window.
function loadBundle() {
  if (window.WebEyeTrackProxy) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = './vendor/webeyetrack.js';
    s.onload = () => (window.WebEyeTrackProxy ? resolve() : reject(new Error('bundle loaded but WebEyeTrackProxy is missing')));
    s.onerror = () => reject(new Error('vendor/webeyetrack.js not found (run npm run gaze)'));
    document.head.append(s);
  });
}

/**
 * Starts the tracker on the app's camera `<video>`. `onPoint(x, y, open, t)` gets the predicted point in
 * window-normalized coordinates (-0.5..0.5, +y down, origin at the window center) per processed frame.
 * Returns { label(clientX, clientY), stop() }. `label` tells the model where the eyes really are right
 * now (a calibration dot, a confirmed pick); the model keeps its last few labels and re-fits.
 */
export async function startWebEyeTrack(video, onPoint) {
  await loadBundle();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let stopped = false;
  let lastSent = 0;

  // Stands in for the bundle's WebcamClient: same `startWebcam(cb)` shape, but frames come from the
  // video element the vision module already opened, so the camera is opened once.
  const frames = {
    async startWebcam(cb) {
      const loop = () => {
        if (stopped) return;
        video.requestVideoFrameCallback(loop);
        const now = performance.now();
        if (now - lastSent < 1000 / MAX_FPS || !video.videoWidth) return;
        lastSent = now;
        if (canvas.width !== video.videoWidth) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        ctx.drawImage(video, 0, 0);
        cb(ctx.getImageData(0, 0, canvas.width, canvas.height), now);
      };
      video.requestVideoFrameCallback(loop);
    },
    stopWebcam() { stopped = true; },
  };

  const proxy = new window.WebEyeTrackProxy(frames);
  proxy.onGazeResults = (res) => {
    if (stopped || !res?.normPog) return;
    const [x, y] = res.normPog;
    if (Number.isFinite(x) && Number.isFinite(y)) onPoint(x, y, res.gazeState !== 'closed', performance.now());
  };

  return {
    label(clientX, clientY) {
      // Same message the bundle sends for a mouse click: a labeled point in window-normalized coordinates.
      proxy.worker.postMessage({ type: 'click', payload: { x: clientX / window.innerWidth - 0.5, y: clientY / window.innerHeight - 0.5 } });
    },
    stop() {
      stopped = true;
      proxy.worker.terminate();
    },
  };
}

// Window-normalized point → gaze-area coordinates (x and y in [-1, 1] over the area below the top bar).
export function toArea(nx, ny, area) {
  const px = (nx + 0.5) * window.innerWidth;
  const py = (ny + 0.5) * window.innerHeight;
  return [((px - area.left) / area.width) * 2 - 1, ((py - area.top) / area.height) * 2 - 1];
}

/**
 * Box picker on a screen point: left/right and top/bottom decided separately, a rest zone in the
 * middle, hysteresis at the midlines, and a dwell before the focus changes. Same rules as the vision
 * module's QuadrantClassifier, on a point instead of eye features. `reach` is where the corner marks
 * sit (0.9 of the area), so `dead` and `margin` are shares of center-to-mark, as in the vision module.
 */
export class AxisPicker {
  constructor({ focusMs = 300, dead = 0.3, margin = 0.15, reach = 0.9 } = {}) {
    Object.assign(this, { focusMs, dead, margin, reach });
    this.looking = null;
    this.focus = null;
    this.since = 0;
  }

  update(t, ax, ay) {
    const x = ax / this.reach;
    const y = ay / this.reach;
    const { dead, margin } = this;
    const quadrantAt = (qx, qy) => (qy < 0 ? (qx < 0 ? 'topLeft' : 'topRight') : qx < 0 ? 'bottomLeft' : 'bottomRight');
    let target;
    if (this.looking === null || this.looking === 'center') {
      const inDead = Math.abs(x) < dead && Math.abs(y) < dead;
      target = inDead || (this.looking === 'center' && Math.abs(x) < dead + margin && Math.abs(y) < dead + margin) ? 'center' : quadrantAt(x, y);
    } else if (Math.abs(x) < dead - margin && Math.abs(y) < dead - margin) {
      target = 'center';
    } else {
      const curX = this.looking.endsWith('Right') ? 1 : -1;
      const curY = this.looking.startsWith('bottom') ? 1 : -1;
      target = quadrantAt(x * curX < -margin ? -curX : curX, y * curY < -margin ? -curY : curY);
    }
    if (target !== this.looking) {
      this.looking = target;
      this.since = t;
    }
    const next = target === 'center' ? null : target;
    if (next !== this.focus && t - this.since >= this.focusMs) this.focus = next;
    return this.focus;
  }
}
