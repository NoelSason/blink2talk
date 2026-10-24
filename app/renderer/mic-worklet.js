// Mic samples -> 100 ms chunks of 16 kHz pcm_s16le for Cartesia Ink-2. Runs on the audio thread.
// Same as the PCM worklet in conversation/public/patient.html, in a file because the page's
// security policy doesn't run scripts from blob: URLs.
class PCM16 extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Int16Array(1600);
    this.n = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        const v = Math.max(-1, Math.min(1, channel[i]));
        this.buffer[this.n++] = v < 0 ? v * 32768 : v * 32767;
        if (this.n === this.buffer.length) {
          this.port.postMessage(this.buffer.buffer.slice(0));
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('pcm16', PCM16);
