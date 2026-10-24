import Cartesia, { toFile } from "@cartesia/cartesia-js";

let client: Cartesia | undefined;

/** Text of one short WAV clip of the nurse speaking, via Cartesia Ink (batch STT). */
export async function transcribe(wav: Buffer): Promise<string> {
  client ??= new Cartesia({ apiKey: process.env.CARTESIA_API_KEY });
  const res = await client.stt.transcribe({
    file: await toFile(wav, "nurse.wav", { type: "audio/wav" }),
    model: "ink-whisper",
    language: "en",
  });
  return res.text.trim();
}
