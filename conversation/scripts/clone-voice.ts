import fs from "node:fs";
import Cartesia from "@cartesia/cartesia-js";

const clipPath = process.argv[2];
const name = process.argv[3] ?? "BlinkVoice patient";
if (!clipPath) {
  console.error("usage: npm run clone -- path/to/clip.wav [voice name]");
  process.exit(1);
}
const client = new Cartesia({ apiKey: process.env.CARTESIA_API_KEY });
const voice = await client.voices.clone({ clip: fs.createReadStream(clipPath), language: "en", name });
console.log(`Cloned voice id: ${voice.id}\nPut this in .env as CARTESIA_VOICE_ID=${voice.id}`);
