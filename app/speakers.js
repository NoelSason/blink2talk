// Who is speaking (main process). A speaker-recognition model, NVIDIA's TitaNet-Large run on this
// machine by sherpa-onnx, turns each nurse-mic turn into a voice print (192 numbers). A print close to
// a voice heard earlier gets that voice's id; anything else is a new voice. Prints stay in memory for
// this launch only and never leave the machine. Claude then names each voice from what it says
// (the conversation server's /replies), so the screen can say "Dr. Lee" instead of "voice 2".
const fs = require('node:fs');
const path = require('node:path');

const MODEL = path.join(__dirname, 'models', 'nemo_en_titanet_large.onnx');
const RATE = 16000;
// Cosine similarity at which two prints are the same person. On synthetic test voices the same
// voice scored 0.81–0.92 and different voices 0.08–0.53; a laptop mic across a room scores lower.
const SAME_VOICE = 0.6;
// Under this much speech a print is unreliable ("OK", "yes"): it can match a known voice only when
// clearly close, and never starts a new one.
const SHORT_SECONDS = 1.0;
const SHORT_SAME_VOICE = 0.7;
const MIN_SECONDS = 0.4;

const unit = (v) => {
  const n = Math.hypot(...v) || 1;
  return Array.from(v, (x) => x / n);
};
const cosine = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

// voices: [{ id, print (unit vector), n }]. Adds or updates a voice in place.
// Returns { voice, similarity, isNew }, or null when the clip is too short to say.
function matchVoice(voices, print, seconds) {
  const p = unit(print);
  let best = null;
  let similarity = -1;
  for (const v of voices) {
    const sim = cosine(v.print, p);
    if (sim > similarity) [best, similarity] = [v, sim];
  }
  const short = seconds < SHORT_SECONDS;
  if (best && similarity >= (short ? SHORT_SAME_VOICE : SAME_VOICE)) {
    // The voice's print becomes the running mean of its turns, so it steadies as they talk.
    best.print = unit(best.print.map((x, i) => x * best.n + p[i]));
    best.n++;
    return { voice: best.id, similarity, isNew: false };
  }
  if (short) return null;
  const v = { id: `voice-${voices.length + 1}`, print: p, n: 1 };
  voices.push(v);
  return { voice: v.id, similarity, isNew: true };
}

let extractor; // undefined: not loaded yet; null: unavailable
const voices = [];

function load() {
  if (extractor !== undefined) return extractor;
  try {
    if (!fs.existsSync(MODEL)) throw new Error(`no model at ${MODEL} (npm run voices)`);
    const sherpa = require('sherpa-onnx-node');
    extractor = new sherpa.SpeakerEmbeddingExtractor({ model: MODEL, numThreads: 2, debug: 0, provider: 'cpu' });
  } catch (err) {
    console.warn(`speaker recognition off: ${err.message}`);
    extractor = null;
  }
  return extractor;
}

// pcm: 16 kHz mono pcm_s16le (ArrayBuffer) of one turn, silence already trimmed by the renderer.
function identify(pcm) {
  const samples = Float32Array.from(new Int16Array(pcm), (x) => x / 32768);
  const seconds = samples.length / RATE;
  if (seconds < MIN_SECONDS || !load()) return null;
  const stream = extractor.createStream();
  stream.acceptWaveform({ samples, sampleRate: RATE });
  stream.inputFinished();
  if (!extractor.isReady(stream)) return null;
  // false: copy the print out. Electron forbids native "external" buffers, sherpa-onnx's default.
  return matchVoice(voices, extractor.compute(stream, false), seconds);
}

module.exports = { identify, load, matchVoice, SAME_VOICE };
