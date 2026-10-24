// Nurse microphone: streams to Cartesia Ink-2, whose turn detection decides when the nurse is done.
// Same approach as conversation/public/patient.html. The token comes from the conversation server's
// /stt-token (STT-only, 1 hour), so the page never sees the API key. While `muted()` is true (the
// app is speaking), silence is sent instead, so the patient's voice isn't transcribed as the nurse.

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
  node.port.onmessage = ({ data }) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(muted() ? new ArrayBuffer(data.byteLength) : data);
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
    if (m.type === 'turn.update') onPartial(m.transcript ?? '');
    else if (m.type === 'turn.end') onTurn((m.transcript ?? '').trim());
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
