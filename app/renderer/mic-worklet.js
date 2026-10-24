// Copies microphone samples to the page for mic.js. Runs on the audio thread.
class MicCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor('mic-capture', MicCapture);
