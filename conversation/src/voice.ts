import Cartesia from "@cartesia/cartesia-js";

// Docs sample voice, used only until CARTESIA_VOICE_ID (the cloned voice) is set.
const FALLBACK_VOICE = "6ccbfb76-1fc6-48f7-b71d-91ac6298247b";

let client: Cartesia | undefined;
const cache = new Map<string, Buffer>();

export function voiceId(): string {
  return process.env.CARTESIA_VOICE_ID || FALLBACK_VOICE;
}

export function usingClone(): boolean {
  return !!process.env.CARTESIA_VOICE_ID;
}

/** WAV bytes for `text` in the patient's voice. Cached so repeats (urgent phrases) are instant. */
export async function synthesize(text: string): Promise<Buffer> {
  const key = `${voiceId()}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  client ??= new Cartesia({ apiKey: process.env.CARTESIA_API_KEY });
  const res = await client.tts.generate({
    model_id: "sonic-3.6",
    transcript: text,
    voice: voiceId(),
    output_format: { container: "wav", encoding: "pcm_s16le", sample_rate: 44100 },
    language: "en",
  });
  const buf = Buffer.from(await res.arrayBuffer());
  cache.set(key, buf);
  return buf;
}

export async function warm(texts: string[]): Promise<void> {
  await Promise.allSettled(texts.map((t) => synthesize(t)));
}
