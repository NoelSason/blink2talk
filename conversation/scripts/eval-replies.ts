// Scores /replies on labeled nurse phrases: rule checks, high-stakes and room-talk labels, latency,
// and a 1-5 grade from Claude Opus 5.5 for how well the three replies cover what a patient would say.
//   npm run eval:replies                                 the model in CLAUDE_MODEL (default in claude.ts)
//   CLAUDE_MODEL=claude-sonnet-5-5 npm run eval:replies  another model
// Set OUT=path.json to save every reply set. Each run costs a few cents.
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { getReplies, MODEL } from "../src/claude.js";

type Kind = "yesno" | "choice" | "scale" | "where" | "open";
interface Case {
  q: string;
  kind: Kind;
  highStakes?: boolean;
  addressed?: boolean; // false: room talk, not for the patient
  choices?: string[]; // a choice question's options, each of which should be offered
}

const CASES: Case[] = [
  { q: "Are you thirsty?", kind: "yesno" },
  { q: "Are you in any pain right now?", kind: "yesno" },
  { q: "Do you need to be suctioned?", kind: "yesno" },
  { q: "Are you cold?", kind: "yesno" },
  { q: "Would you like me to raise the head of your bed?", kind: "yesno" },
  { q: "Do you want the lights off?", kind: "yesno" },
  { q: "Your wife Maria is here. Should I bring her in?", kind: "yesno" },
  { q: "Did you sleep okay last night?", kind: "yesno" },
  { q: "Are you feeling anxious?", kind: "yesno" },
  { q: "Is the tube bothering you?", kind: "yesno" },
  { q: "Do you need to use the bathroom?", kind: "yesno" },
  { q: "Do you want me to call your daughter?", kind: "yesno" },
  { q: "Do you want the TV on?", kind: "yesno" },
  { q: "Can you hear me okay?", kind: "yesno" },
  { q: "Is the medication helping with your nausea?", kind: "yesno" },
  { q: "Okay if I turn you onto your side for a bit?", kind: "yesno" },
  { q: "Do you want me to read you your messages?", kind: "yesno" },
  { q: "On a scale of one to ten, how bad is the pain?", kind: "scale" },
  { q: "How bad is your pain from zero to ten?", kind: "scale" },
  { q: "Do you want the doctor or the nurse?", kind: "choice", choices: ["doctor", "nurse"] },
  { q: "Would you like tea or water?", kind: "choice", choices: ["tea", "water"] },
  { q: "Do you want the blinds open or closed?", kind: "choice", choices: ["open", "closed"] },
  { q: "Where does it hurt?", kind: "where" },
  { q: "What would make you more comfortable?", kind: "open" },
  { q: "Who would you like to visit today?", kind: "open" },
  { q: "How are you feeling today?", kind: "open" },
  { q: "Is there anything you need?", kind: "open" },
  { q: "Do you know where you are?", kind: "open" },
  { q: "Hi, I'm Doctor Okafor, I'll be looking after you tonight. How's your breathing?", kind: "open" },
  { q: "The doctor is going to do a procedure on your arm, is that okay?", kind: "yesno", highStakes: true },
  { q: "Do you agree to the blood transfusion?", kind: "yesno", highStakes: true },
  { q: "We need to give you a sedative, okay?", kind: "yesno", highStakes: true },
  { q: "Do you want to be resuscitated if your heart stops?", kind: "yesno", highStakes: true },
  { q: "Do you want more of the pain medicine through your IV?", kind: "yesno", highStakes: true },
  { q: "Can we place a feeding tube tomorrow morning?", kind: "yesno", highStakes: true },
  { q: "Hey, can you grab the chart from room 4?", kind: "open", addressed: false },
  { q: "Dr. Patel, the labs from bed 6 came back.", kind: "open", addressed: false },
];

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const NUMBER = /\b(\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/i;
// "Not yet" or "Not much" is an in-between answer, not a second no.
const polarity = (s: string) => (/^(yes|yeah|yep|sure)\b/i.test(s) ? "yes" : /^(no|nope)\b/i.test(s) ? "no" : null);

// Rule problems with one reply set, as short labels.
function problems(c: Case, replies: string[], highStakes: boolean): string[] {
  const out: string[] = [];
  if (replies.length !== 3) out.push(`${replies.length} replies`);
  if (replies.some((r) => words(r) > 8)) out.push("over 8 words");
  const norm = replies.map((r) => r.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim());
  if (new Set(norm).size < norm.length) out.push("duplicate");
  if (!highStakes) {
    const p = replies.map(polarity);
    if (p.filter((x) => x === "yes").length > 1) out.push("two yeses");
    if (p.filter((x) => x === "no").length > 1) out.push("two noes");
  }
  if (c.kind === "scale" && replies.filter((r) => NUMBER.test(r)).length < 2) out.push("scale without numbers");
  if (c.choices) for (const ch of c.choices) if (!replies.some((r) => r.toLowerCase().includes(ch))) out.push(`no "${ch}"`);
  return out;
}

const judge = new Anthropic();
const GRADE_SCHEMA = {
  type: "object",
  properties: { score: { type: "integer" }, issue: { type: "string" } },
  required: ["score", "issue"],
  additionalProperties: false,
} as const;
const GRADE_SYSTEM = `You grade reply suggestions for an ICU patient who cannot speak. Someone says something to the patient; the app shows three short first-person replies and the patient picks one with their eyes, so each reply must be something the patient could say as-is.

Score 1-5 how well the three replies cover what this patient would most likely want to say:
5 = the three most useful, clearly different answers, short and natural.
4 = good, one reply could be more useful or shorter.
3 = usable, but one reply is wasted (repeats another's meaning, off the question, or awkward).
2 = two replies wasted, or one reply invents a symptom, fact, or decision.
1 = the patient would likely need "None of these".
For speech not meant for the patient (staff talking to each other), grade whether the replies are harmless and sensible if the patient answers anyway.
issue: the main problem in a few words, or "none".`;

async function grade(q: string, replies: string[]): Promise<{ score: number; issue: string }> {
  const res = await judge.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 4096,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema: GRADE_SCHEMA } },
    system: GRADE_SYSTEM,
    messages: [{ role: "user", content: `Said to the patient: "${q}"\nReplies:\n${replies.map((r, i) => `${i + 1}. ${r}`).join("\n")}` }],
  });
  if (res.stop_reason === "refusal") return { score: 0, issue: "grader refused" };
  const block = res.content.find((b) => b.type === "text");
  return JSON.parse(block && block.type === "text" ? block.text : "{}");
}

const results = [];
for (const c of CASES) {
  const t0 = Date.now();
  try {
    const r = await getReplies({ transcript: c.q });
    const ms = Date.now() - t0;
    const g = await grade(c.q, r.replies);
    results.push({
      ...c, ms, replies: r.replies, highStakesGot: r.highStakes, addressedGot: r.addressed,
      problems: problems(c, r.replies, r.highStakes), score: g.score, issue: g.issue,
    });
  } catch (err) {
    results.push({ ...c, ms: Date.now() - t0, replies: [], error: (err as Error).message, problems: ["failed"], score: 0, issue: "failed" });
  }
  const last = results.at(-1)!;
  console.log(`${String(last.ms).padStart(5)} ms  ${last.score}  ${last.problems.join(", ").padEnd(18)}  ${c.q}\n        ${last.replies.join("  |  ")}`);
}

const ok = results.filter((r) => !("error" in r));
const ms = ok.map((r) => r.ms).sort((a, b) => a - b);
const pick = (p: number) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))];
const hs = results.filter((r) => "highStakesGot" in r && (r.highStakesGot === true) !== (r.highStakes === true));
const addr = results.filter((r) => "addressedGot" in r && r.addressedGot !== (r.addressed !== false));
const summary = {
  model: MODEL,
  cases: results.length,
  failed: results.length - ok.length,
  meanScore: Number((results.reduce((s, r) => s + r.score, 0) / results.length).toFixed(2)),
  sets5: results.filter((r) => r.score === 5).length,
  setsWithRuleProblems: results.filter((r) => r.problems.length).length,
  highStakesWrong: hs.map((r) => r.q),
  addressedWrong: addr.map((r) => r.q),
  medianMs: pick(0.5),
  p90Ms: pick(0.9),
  wordsPerReply: Number((ok.flatMap((r) => r.replies).reduce((s, x) => s + words(x), 0) / Math.max(1, ok.length * 3)).toFixed(1)),
};
console.log(`\n${JSON.stringify(summary, null, 2)}`);
if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify({ summary, results }, null, 2));
