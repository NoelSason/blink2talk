// Copies the WebEyeTrack browser bundle (npm `webeyetrack`) into renderer/vendor/ with its URLs pointed
// at this app instead of the page origin and public CDNs, so it works offline under app://blink2talk/.
// Runs from `npm run gaze` (part of prestart). The gaze network weights live in renderer/web/ (committed).
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(app, 'node_modules', 'webeyetrack', 'dist', 'index.js');
const outDir = join(app, 'renderer', 'vendor');
const out = join(outDir, 'webeyetrack.js');

let js = readFileSync(src, 'utf8');
const patches = [
  // BlazeGaze weights: the bundle assumes they're served at the page origin's /web/.
  ['"".concat(self.location.origin,"/web/model.json")', '"app://blink2talk/web/model.json"'],
  // Its own MediaPipe Face Landmarker: use the runtime and model `npm run eyes` already copies in.
  ['https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm', 'app://blink2talk/mediapipe/wasm'],
  ['https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task', 'app://blink2talk/models/face_landmarker.task'],
  // Labeled points reach the model through its "click" path, and it deletes click points after 60 s:
  // a minute after calibrating, all five dots were gone and it ran uncalibrated. Keep them for the session.
  ['function e(e,t){void 0===e&&(e=5),void 0===t&&(t=60),', 'function e(e,t){void 0===e&&(e=5),void 0===t&&(t=1e9),'],
];
for (const [from, to] of patches) {
  if (!js.includes(from)) throw new Error(`webeyetrack bundle changed: "${from.slice(0, 60)}" not found; update scripts/webeyetrack.mjs`);
  js = js.split(from).join(to);
}
mkdirSync(outDir, { recursive: true });
writeFileSync(out, js);
copyFileSync(join(app, 'node_modules', 'webeyetrack', 'dist', 'index.js.LICENSE.txt'), join(outDir, 'webeyetrack.LICENSE.txt'));
console.log(`WebEyeTrack bundle ready in ${outDir}`);
