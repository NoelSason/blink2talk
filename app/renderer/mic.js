// Nurse microphone: streams to Cartesia Ink-2, whose turn detection decides when the nurse is done.
// Same approach as conversation/public/patient.html. The token comes from the conversation server's
// /stt-token (STT-only, 1 hour), so the page never sees the API key. While `muted()` is true (the
// app is speaking), silence is sent instead, so the patient's voice isn't transcribed as the nurse.
//
// Each turn's audio also goes to onTurn, trimmed to the parts with speech, so the main process can
// tell which voice said it (speakers.js).

const CHUNKS_BEFORE = 15; // 1.5 s kept from before a turn is detected, where its first words are
const MAX_CHUNKS = 300;   // 30 s per turn is plenty for a voice print

// Int16 chunks -> one ArrayBuffer of the chunks loud enough to be speech, or null.
function speechOnly(chunks) {
  const rms = chunks.map((c) => Math.sqrt(c.reduce((s, x) => s + x * x, 0) / c.length));
  const loud = [...rms].sort((a, b) => a - b)[Math.floor(rms.length * 0.9)] ?? 0;
  const keep = chunks.filter((_, i) => rms[i] >= Math.max(150, 0.3 * loud));
  if (!keep.length) return null;
  const out = new Int16Array(keep.reduce((n, c) => n + c.length, 0));
  keep.reduce((offset, c) => (out.set(c, offset), offset + c.length), 0);
  return out.buffer;
}

export async function startMic({ token, muted, onPartial, onTurn, onError }) {
  const q = new URLSearchParams({
    model: 'ink-2',
    encoding: 'pcm_s16le',
    sample_rate: '16000',
    cartesia_version: '2026-08-14',
    access_token: token,
  });
  const ws = new WebSocket(`wss://api.cartesia.ai/stt/turns/websocket?${q}`);
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const ctx = new AudioContext({ sampleRate: 16000 });
  await ctx.audioWorklet.addModule('./mic-worklet.js');
  const node = new AudioWorkletNode(ctx, 'pcm16');
  let before = []; // the last CHUNKS_BEFORE chunks while nobody is mid-turn
  let turn = null; // chunks since the current turn was detected
  node.port.onmessage = ({ data }) => {
    const silent = muted();
    if (ws.readyState === WebSocket.OPEN) ws.send(silent ? new ArrayBuffer(data.byteLength) : data);
    if (silent) return;
    const chunk = new Int16Array(data);
    if (turn) {
      if (turn.length < MAX_CHUNKS) turn.push(chunk);
    } else {
      before.push(chunk);
      if (before.length > CHUNKS_BEFORE) before.shift();
    }
  };
  ctx.createMediaStreamSource(stream).connect(node);

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'close' }));
    stream.getTracks().forEach((t) => t.stop());
    ctx.close();
  };
  ws.onmessage = (event) => {
    const m = JSON.parse(event.data);
    if ((m.type === 'turn.start' || m.type === 'turn.update') && !turn) turn = before;
    if (m.type === 'turn.update') onPartial(m.transcript ?? '');
    else if (m.type === 'turn.end') {
      const audio = speechOnly(turn ?? before);
      turn = null;
      before = [];
      onTurn((m.transcript ?? '').trim(), audio);
    }
    else if (m.type === 'error') {
      onError(m.message ?? 'speech service error');
      stop();
    }
  };
  ws.onclose = () => {
    if (!stopped) {
      stop();
      onError('connection closed');
    }
  };
  return { stop };
}
