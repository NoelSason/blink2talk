// Nurse microphone. Listens for one utterance at a time with simple energy-based voice detection, then
// hands it over as a 16 kHz WAV clip for speech-to-text. `paused()` is checked on every frame; the app
// pauses the mic while it speaks, so it never transcribes its own voice.

const OUT_RATE = 16000;
const FRAME_MS = 20;
const START_MS = 140;   // this much voice in a row starts an utterance
const END_MS = 800;     // this much quiet ends it (same as the Chrome mic in patient.html: ~700 ms)
const MIN_MS = 450;     // shorter bursts (a cough, a door) are dropped
const MAX_MS = 15000;
const PREROLL_MS = 300; // keep the start of the first word

export async function startMic({ paused, onStart, onCancel, onClip }) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  });
  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule('./mic-worklet.js');
  const source = ctx.createMediaStreamSource(stream);
  const capture = new AudioWorkletNode(ctx, 'mic-capture');
  const silent = ctx.createGain();
  silent.gain.value = 0; // the graph has to reach the speakers to run; nothing is audible
  source.connect(capture).connect(silent).connect(ctx.destination);

  const frameLen = Math.round((ctx.sampleRate * FRAME_MS) / 1000);
  let pending = new Float32Array(0);
  let noise = 0.005;
  let speaking = false;
  let voicedMs = 0;
  let quietMs = 0;
  let clip = [];
  let preroll = [];

  const resetUtterance = () => {
    speaking = false;
    voicedMs = quietMs = 0;
    clip = [];
    preroll = [];
  };

  function onFrame(frame) {
    if (paused()) {
      if (speaking) onCancel();
      resetUtterance();
      return;
    }
    let sum = 0;
    for (const v of frame) sum += v * v;
    const rms = Math.sqrt(sum / frame.length);
    const threshold = Math.max(noise * 3, 0.012);
    const voiced = rms > threshold;

    if (!speaking) {
      if (!voiced) noise = noise * 0.98 + rms * 0.02; // track the room's background level
      preroll.push(frame);
      if (preroll.length * FRAME_MS > PREROLL_MS) preroll.shift();
      voicedMs = voiced ? voicedMs + FRAME_MS : 0;
      if (voicedMs >= START_MS) {
        speaking = true;
        clip = [...preroll];
        quietMs = 0;
        onStart();
      }
      return;
    }
    clip.push(frame);
    quietMs = voiced ? 0 : quietMs + FRAME_MS;
    const lengthMs = clip.length * FRAME_MS;
    if (quietMs >= END_MS || lengthMs >= MAX_MS) {
      const frames = clip;
      const spokenMs = lengthMs - quietMs;
      resetUtterance();
      if (spokenMs >= MIN_MS) onClip(encodeWav(frames, ctx.sampleRate));
      else onCancel();
    }
  }

  capture.port.onmessage = ({ data }) => {
    const joined = new Float32Array(pending.length + data.length);
    joined.set(pending);
    joined.set(data, pending.length);
    let i = 0;
    for (; i + frameLen <= joined.length; i += frameLen) onFrame(joined.subarray(i, i + frameLen));
    pending = joined.slice(i);
  };

  return {
    stop() {
      stream.getTracks().forEach((t) => t.stop());
      ctx.close();
    },
  };
}

// 16-bit mono WAV at 16 kHz, averaging input samples down to the output rate.
function encodeWav(frames, inRate) {
  const total = frames.reduce((n, f) => n + f.length, 0);
  const input = new Float32Array(total);
  let offset = 0;
  for (const f of frames) {
    input.set(f, offset);
    offset += f.length;
  }
  const ratio = inRate / OUT_RATE;
  const outLen = Math.floor(total / ratio);
  const buffer = new ArrayBuffer(44 + outLen * 2);
  const view = new DataView(buffer);
  const text = (at, s) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + outLen * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, OUT_RATE, true);
  view.setUint32(28, OUT_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, outLen * 2, true);
  for (let i = 0; i < outLen; i++) {
    const from = Math.floor(i * ratio);
    const to = Math.max(from + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = from; j < to; j++) sum += input[j];
    const v = Math.max(-1, Math.min(1, sum / (to - from)));
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return buffer;
}
