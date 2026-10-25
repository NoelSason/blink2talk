// Scores /replies on labeled nurse phrases: rule checks, high-stakes and room-talk labels, latency,
// and a 1-5 grade from Claude Opus 5.5 for how well the three replies cover what a patient would say.
//   npm run eval:replies                                 the model in CLAUDE_MODEL (default in claude.ts)
//   CLAUDE_MODEL=claude-sonnet-5-5 npm run eval:replies  another model
//   SET=held-out npm run eval:replies                    only the held-out phrases (or SET=tuned)
// Set OUT=path.json to save every reply set. Each run costs a few cents.
// The prompt was tuned on CASES, so their score flatters it; HELD_OUT is the honest number.
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

// Written after the prompt was tuned and never used to change it. Keep it that way: don't edit the
// prompt to fix a held-out phrase, and write fresh held-out phrases after any prompt change.
const HELD_OUT: Case[] = [
  { q: "Do you want me to fix your pillow?", kind: "yesno" },
  { q: "Is your mouth dry?", kind: "yesno" },
  { q: "Are you having trouble breathing?", kind: "yesno" },
  { q: "Would you like some music on?", kind: "yesno" },
  { q: "Is it too loud in here?", kind: "yesno" },
  { q: "Do you feel sick to your stomach?", kind: "yesno" },
  { q: "Your son called. Do you want me to tell him you're doing okay?", kind: "yesno" },
  { q: "Are you itchy anywhere?", kind: "yesno" },
  { q: "Do you want me to wipe your face?", kind: "yesno" },
  { q: "Is the blood pressure cuff too tight?", kind: "yesno" },
  { q: "Did the doctor explain your test results to you?", kind: "yesno" },
  { q: "Do you want your glasses?", kind: "yesno" },
  { q: "Can I check the dressing on your leg?", kind: "yesno" },
  { q: "Are you feeling dizzy?", kind: "yesno" },
  { q: "Would you like your family to stay overnight?", kind: "yesno" },
  { q: "How hard is it to breathe, one being easy and ten being very hard?", kind: "scale" },
  { q: "From one to five, how tired are you?", kind: "scale" },
  { q: "Would you like ice chips or a mouth swab?", kind: "choice", choices: ["ice", "swab"] },
  { q: "Should I call your wife or your sister first?", kind: "choice", choices: ["wife", "sister"] },
  { q: "Do you want to sit up or lie flat?", kind: "choice", choices: ["sit", "flat"] },
  { q: "Where do you feel the pressure?", kind: "where" },
  { q: "What can I do for you right now?", kind: "open" },
  { q: "What's worrying you the most?", kind: "open" },
  { q: "Good morning, I'm Sam, your respiratory therapist. How did the night go?", kind: "open" },
  { q: "What would you like to eat once the tube is out?", kind: "open" },
  { q: "What kind of music do you like?", kind: "open" },
  { q: "How's the new pain patch working?", kind: "open" },
  { q: "We'd like to put you on a ventilator tonight. Do you agree?", kind: "yesno", highStakes: true },
  { q: "Is it okay if we put in a central line?", kind: "yesno", highStakes: true },
  { q: "Do you consent to the surgery tomorrow?", kind: "yesno", highStakes: true },
  { q: "Should we stop the dialysis?", kind: "yesno", highStakes: true },
  { q: "Do you want us to increase the morphine?", kind: "yesno", highStakes: true },
  { q: "Can someone cover my patients while I take a break?", kind: "open", addressed: false },
  { q: "Pharmacy says the antibiotic will be up in twenty minutes.", kind: "open", addressed: false },
];

const SET = process.env.SET ?? "all"; // all | tuned | held-out
const RUN = [
  ...(SET === "held-out" ? [] : CASES.map((c) => ({ ...c, set: "tuned" }))),
  ...(SET === "tuned" ? [] : HELD_OUT.map((c) => ({ ...c, set: "held-out" }))),
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
for (const c of RUN) {
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
const mean = (rs: { score: number }[]) => (rs.length ? Number((rs.reduce((s, r) => s + r.score, 0) / rs.length).toFixed(2)) : null);
const summary = {
  model: MODEL,
  cases: results.length,
  failed: results.length - ok.length,
  meanScore: mean(results),
  meanScoreTuned: mean(results.filter((r) => r.set === "tuned")),
  meanScoreHeldOut: mean(results.filter((r) => r.set === "held-out")),
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
