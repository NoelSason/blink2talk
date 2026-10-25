// Nurse microphone, streamed to Cartesia Ink-2. Two modes, chosen in the care panel:
//   startTalk: push-to-talk. The nurse holds M while talking; letting go sends `close`, Ink
//              transcribes what it has, and onTurn gets everything said during the hold as one turn.
//              The mic is off between holds, so room talk is never transcribed.
//   startMic:  always listening. Ink's turn detection decides when the nurse is done.
// Same approach as conversation/public/patient.html. The token comes from the conversation server's
// /stt-token (STT-only, 1 hour), so the page never sees the API key. While `muted()` is true (the
// app is speaking), silence is sent instead, so the patient's voice isn't transcribed as the nurse.
//
// Each turn's audio also goes to onTurn, trimmed to the parts with speech, so the main process can
// tell which voice said it (speakers.js).

const CHUNKS_BEFORE = 15; // always listening: 1.5 s kept from before a turn is detected, where its first words are
const MAX_CHUNKS = 300;   // 30 s per turn is plenty for a voice print
// Push-to-talk, after letting go: mid-sentence, Ink transcribes the rest and hangs up (about 0.8 s,
// measured); CLOSE_WAIT is the most we wait for that. If the last sentence had already ended, Ink
// doesn't hang up, so the turn is sent after GRACE (in case the last moments held new words).
const CLOSE_WAIT = 2000;
const GRACE = 300;

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

// No turn config message: sending { type: 'config', turn: { end_timeout_ms, end_threshold } } (as
// conversation/public/patient.html does) stops Ink-2 returning any transcript (tested 2026-10-24).
function inkSocket(token) {
  const q = new URLSearchParams({
    model: 'ink-2',
    encoding: 'pcm_s16le',
    sample_rate: '16000',
    cartesia_version: '2026-08-14',
    access_token: token,
  });
  return new WebSocket(`wss://api.cartesia.ai/stt/turns/websocket?${q}`);
}

// The mic as 16 kHz pcm_s16le chunks (mic-worklet.js), about 100 ms each.
async function openAudio() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const ctx = new AudioContext({ sampleRate: 16000 });
  await ctx.audioWorklet.addModule('./mic-worklet.js');
  const node = new AudioWorkletNode(ctx, 'pcm16');
  ctx.createMediaStreamSource(stream).connect(node);
  const close = () => {
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => {});
  };
  return { node, close };
}

// Push-to-talk: one hold of M. Returns { release }: call it when M comes up. onPartial gets the words
// so far; onTurn(text, audio) fires once, after release; onError(message) instead if the stream fails.
export async function startTalk({ token, muted, onPartial, onTurn, onError }) {
  const ws = inkSocket(token);
  const audio = await openAudio();

  const queue = [];  // audio from before the socket opens, so the first words aren't lost
  const chunks = []; // this hold's speech, for the voice print
  const flush = () => { while (queue.length) ws.send(queue.shift()); };
  let finals = [];   // Ink can end several turns inside one hold (the nurse paused); they're joined
  let current = '';
  let inTurn = false; // Ink has started a turn it hasn't ended
  let released = false;
  let done = false;
  let timer = 0;
  const said = () => [...finals, current].join(' ').replace(/\s+/g, ' ').trim();

  audio.node.port.onmessage = ({ data }) => {
    if (released) return;
    const silent = muted();
    const buf = silent ? new ArrayBuffer(data.byteLength) : data;
    if (ws.readyState === WebSocket.OPEN) {
      flush();
      ws.send(buf);
    } else if (ws.readyState === WebSocket.CONNECTING) queue.push(buf);
    if (!silent && chunks.length < MAX_CHUNKS) chunks.push(new Int16Array(data));
  };

  const finish = (error = null) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    audio.close();
    try { ws.close(); } catch {}
    if (error) onError(error);
    else onTurn(said(), speechOnly(chunks));
  };

  ws.onopen = () => {
    flush();
    if (released) ws.send(JSON.stringify({ type: 'close' }));
  };
  ws.onmessage = (event) => {
    const m = JSON.parse(event.data);
    if (m.type === 'turn.start' || m.type === 'turn.update') {
      // New words after letting go (the last moments of the hold): wait for Ink to finish them.
      if (released && !inTurn) {
        clearTimeout(timer);
        timer = setTimeout(() => finish(), CLOSE_WAIT);
      }
      inTurn = true;
      if (m.type === 'turn.start') return;
      current = m.transcript ?? '';
    } else if (m.type === 'turn.end') {
      inTurn = false;
      finals.push(m.transcript ?? '');
      current = '';
    } else if (m.type === 'error') return finish(m.message ?? 'speech service error');
    else return;
    onPartial(said());
  };
  // After release, the server hangs up once it has transcribed everything: that's the normal end.
  ws.onclose = () => finish(released ? null : 'connection closed');

  return {
    release() {
      if (released) return;
      released = true;
      audio.close();
      // `close` makes Ink transcribe the audio it has, then hang up.
      if (ws.readyState === WebSocket.OPEN) {
        flush();
        ws.send(JSON.stringify({ type: 'close' }));
      }
      timer = setTimeout(() => finish(), !inTurn && finals.length ? GRACE : CLOSE_WAIT);
    },
  };
}

// Always listening. onEagerEnd: Ink-2 thinks the nurse is probably done (replies can start);
// onResume: they weren't. Split questions are joined in app.js.
export async function startMic({ token, muted, onPartial, onEagerEnd, onResume, onTurn, onError }) {
  const ws = inkSocket(token);
  const audio = await openAudio();
  let before = []; // the last CHUNKS_BEFORE chunks while nobody is mid-turn
  let turn = null; // chunks since the current turn was detected
  audio.node.port.onmessage = ({ data }) => {
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

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'close' }));
    audio.close();
  };
  ws.onmessage = (event) => {
    const m = JSON.parse(event.data);
    if ((m.type === 'turn.start' || m.type === 'turn.update') && !turn) turn = before;
    if (m.type === 'turn.update') onPartial(m.transcript ?? '');
    else if (m.type === 'turn.eager_end') onEagerEnd((m.transcript ?? '').trim());
    else if (m.type === 'turn.resume') onResume();
    else if (m.type === 'turn.end') {
      const chunks = turn ?? before;
      turn = null;
      before = [];
      onTurn((m.transcript ?? '').trim(), speechOnly(chunks));
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
