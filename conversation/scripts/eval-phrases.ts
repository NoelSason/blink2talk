// Runs nurse phrases through getReplies and prints options + latency. `npm run eval`
import { getReplies } from "../src/claude.js";

const PHRASES = [
  "Are you thirsty?",
  "Are you in any pain right now?",
  "On a scale of one to ten, how bad is the pain?",
  "Where does it hurt?",
  "Do you need to be suctioned?",
  "Are you cold?",
  "Would you like me to raise the head of your bed?",
  "Do you want the lights off?",
  "Your wife Maria is here. Should I bring her in?",
  "Did you sleep okay last night?",
  "Do you know where you are?",
  "Are you feeling anxious?",
  "Is the tube bothering you?",
  "Do you need to use the bathroom?",
  "Do you want me to call your daughter?",
  "Do you want the TV on?",
  "The doctor is going to do a procedure on your arm, is that okay?",
  "Do you agree to the blood transfusion?",
  "We need to give you a sedative, okay?",
  "Do you want to be resuscitated if your heart stops?",
  "How are you feeling today?",
  "Is there anything you need?",
  "Can you hear me okay?",
  "Do you want me to read you your messages?",
  "Hey, can you grab the chart from room 4?", // not addressed to the patient
];

const ms: number[] = [];
for (const p of PHRASES) {
  const t0 = Date.now();
  try {
    const r = await getReplies({ transcript: p });
    ms.push(Date.now() - t0);
    console.log(`\n${p}  [${r.source}, ${Date.now() - t0} ms]\n  ${r.replies.join("  |  ")}`);
  } catch (e) {
    console.log(`\n${p}  ERROR ${(e as Error).message} (${Date.now() - t0} ms)`);
  }
}
ms.sort((a, b) => a - b);
console.log(`\nlatency: median ${ms[Math.floor(ms.length / 2)]} ms, max ${ms.at(-1)} ms, n=${ms.length}`);
