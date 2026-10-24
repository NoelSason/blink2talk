// Downloads the speaker-recognition model (NVIDIA TitaNet-Large as ONNX, from sherpa-onnx's releases,
// ~100 MB) into app/models/ once. Without it the app still runs; it just can't tell voices apart.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/nemo_en_titanet_large.onnx';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'models');
const file = path.join(dir, 'nemo_en_titanet_large.onnx');

if (fs.existsSync(file)) process.exit(0);
fs.mkdirSync(dir, { recursive: true });
console.log('Downloading the speaker-recognition model (~100 MB)…');
const res = await fetch(URL);
if (!res.ok) throw new Error(`download failed: ${res.status}`);
const tmp = `${file}.part`;
fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
fs.renameSync(tmp, file);
console.log(`Saved ${file}`);
