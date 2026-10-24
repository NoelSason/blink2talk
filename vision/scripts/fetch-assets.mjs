// Copies MediaPipe's WASM runtime out of node_modules and downloads the face landmarker
// model into a public/ folder, so the app runs without a CDN (venue Wi-Fi, hospital networks).
//
// Usage: node scripts/fetch-assets.mjs [destDir]    (default: this package's public/)
// A consuming app passes its own: `node ../blink_to_talk/scripts/fetch-assets.mjs ./public`.
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = resolve(process.argv[2] ?? join(root, "public"));
const wasmDst = join(dest, "mediapipe/wasm");
const modelDst = join(dest, "models/face_landmarker.task");

// Resolve through node's exports map rather than a hardcoded node_modules path: when another app
// installs this package, npm hoists @mediapipe/tasks-vision into *its* node_modules, not ours.
let wasmSrc;
try {
  wasmSrc = dirname(createRequire(import.meta.url).resolve("@mediapipe/tasks-vision/vision_wasm_internal.js"));
} catch {
  console.error("@mediapipe/tasks-vision is missing. Run `npm install` first.");
  process.exit(1);
}

mkdirSync(wasmDst, { recursive: true });
cpSync(wasmSrc, wasmDst, { recursive: true });

if (!existsSync(modelDst)) {
  mkdirSync(dirname(modelDst), { recursive: true });
  console.log(`Downloading ${MODEL_URL}`);
  const res = await fetch(MODEL_URL);
  if (!res.ok) {
    console.error(`Model download failed: HTTP ${res.status}`);
    process.exit(1);
  }
  writeFileSync(modelDst, Buffer.from(await res.arrayBuffer()));
}

console.log(`MediaPipe assets ready in ${dest}`);
