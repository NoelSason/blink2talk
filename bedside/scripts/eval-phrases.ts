// Classification accuracy and per-stage latency over a labelled set of nurse phrases. `npm run eval`
//
// The gate for this module is classification, not fluency: if the turn type is wrong the slot
// structure is wrong, and no amount of good span generation rescues it. Mislabelling `wh` as `polar`
// costs one escape. Mislabelling `procedure` as `informing` costs the patient their only "Wait".
//
// Extends the 28 phrases in conversation/scripts/eval-phrases.ts with labels and with the two turn
// types that server has no concept of: informing and procedure.

import { classifyByRules } from "../src/classify-rules.js";
import { respondingBoard } from "../src/boards.js";
import { spanCount } from "../src/slots.js";
import type { TurnType } from "../src/types.js";

const CASES: [string, TurnType][] = [
  // polar
  ["Are you thirsty?", "polar"],
  ["Are you in any pain right now?", "polar"],
  ["Do you need to be suctioned?", "polar"],
  ["Are you cold?", "polar"],
  ["Would you like me to raise the head of your bed?", "polar"],
  ["Do you want the lights off?", "polar"],
  ["Did you sleep okay last night?", "polar"],
  ["Do you know where you are?", "polar"],
  ["Are you feeling anxious?", "polar"],
  ["Is the tube bothering you?", "polar"],
  ["Do you need to use the bathroom?", "polar"],
  ["Do you want the TV on?", "polar"],
  ["Can you hear me okay?", "polar"],
  ["Do you want me to read you your messages?", "polar"],
  ["Comfortable?", "polar"],

  // wh
  ["Where does it hurt?", "wh"],
  ["How are you feeling today?", "wh"],
  ["On a scale of one to ten, how bad is the pain?", "wh"],
  ["What do you need?", "wh"],
  ["When did it start hurting?", "wh"],

  // alternative
  ["Do you want tea or water?", "alternative"],
  ["Should I call your daughter or your son?", "alternative"],
  ["Would you rather sit up or stay flat?", "alternative"],

  // consent — must never reach a model
  ["Do you agree to the blood transfusion?", "consent"],
  ["We need to give you a sedative, okay?", "consent"],
  ["Do you want to be resuscitated if your heart stops?", "consent"],
  ["The doctor is going to do a procedure on your arm, is that okay?", "consent"],

  // procedure — the row that does not exist in the current server
  ["I'm going to suction you now", "procedure"],
  ["I'm just going to turn you on your side", "procedure"],
  ["We're about to move you up the bed", "procedure"],
  ["I need to change your dressing", "procedure"],
  ["Let me check your line", "procedure"],
  ["I'm going to sit you up, okay?", "procedure"],
  ["I'll just clean around your mouth", "procedure"],

  // informing — the other missing row; the current server fabricates an answer to these
  ["Your daughter is coming at six", "informing"],
  ["The doctor already came by this morning", "informing"],
  ["Your numbers look better today", "informing"],
  ["It's Thursday afternoon", "informing"],
];

/** How bad is this particular confusion? Drives the summary, not the score. */
const SEVERITY: Partial<Record<TurnType, string>> = {
  procedure: "SEVERE — the patient loses 'Wait'",
  consent: "SEVERE — consent must never reach a model",
};

let correct = 0;
let modelWouldBeAsked = 0;
const failures: string[] = [];
const ms: number[] = [];

for (const [phrase, want] of CASES) {
  const t0 = performance.now();
  const r = classifyByRules(phrase);
  const board = respondingBoard({ turnId: "eval", turnType: r.type, transcript: phrase });
  ms.push(performance.now() - t0);

  if (!r.confident) modelWouldBeAsked++;
  const ok = r.type === want;
  if (ok) correct++;
  else failures.push(`  ${phrase}\n    got ${r.type} (${r.why}), wanted ${want}${SEVERITY[want] ? `  [${SEVERITY[want]}]` : ""}`);

  const boxes = board.slots.map((s) => s?.label ?? "—").join("  |  ");
  console.log(`${ok ? "ok  " : "FAIL"} ${want.padEnd(11)} ${phrase}`);
  console.log(`     ${boxes}`);
}

const pct = (n: number) => `${((n / CASES.length) * 100).toFixed(1)}%`;
const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
const spans = CASES.reduce((a, [, t]) => a + spanCount(t), 0);

console.log(`\n${"=".repeat(70)}`);
console.log(`classification   ${correct}/${CASES.length}  ${pct(correct)}`);
console.log(`rules confident  ${CASES.length - modelWouldBeAsked}/${CASES.length}  (${modelWouldBeAsked} would cost a model call)`);
console.log(`rule latency     mean ${mean.toFixed(3)} ms, max ${Math.max(...ms).toFixed(3)} ms`);
console.log(`spans to generate ${spans} across ${CASES.length} turns  (${(spans / CASES.length).toFixed(2)} per turn)`);
console.log(`  vs. generating 3 replies every turn: ${CASES.length * 3} — a ${(100 - (spans / (CASES.length * 3)) * 100).toFixed(0)}% reduction`);

if (failures.length) {
  console.log(`\nfailures:\n${failures.join("\n")}`);
  process.exitCode = 1;
}
