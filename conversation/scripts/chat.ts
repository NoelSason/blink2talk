// Type what the nurse says, see the three replies, answer as the patient. `npm run chat`
// For working on the prompts (SYSTEM and STARTERS_SYSTEM in src/claude.ts) without the app.
//   1-3  pick (goes into history)   n  none of these (re-ask, then a topic)   Enter  skip
//   /start  "I want to say something": a category, then its phrases three at a time (n pages on)
//   /patient <text>  a line the patient started
//   /prompt  last message sent   /reset  clear history and requests   /quit
// PROFILE=path.json passes a patientProfile ({ "name": ..., "notes": ... }).
import fs from "node:fs";
import readline from "node:readline/promises";
import { buildRepliesPrompt, buildStartersPrompt, CATEGORIES, getReplies, getStarters, MODEL, type RepliesInput, type StartCategory, type Turn } from "../src/claude.js";
import { startCandidates } from "../src/mock.js";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const patientProfile = process.env.PROFILE ? JSON.parse(fs.readFileSync(process.env.PROFILE, "utf8")) : undefined;
let history: Turn[] = [];
let lastPrompt = "";
// Line iterator, not rl.question: it buffers, so a file of phrases can be piped in too.
const lines = rl[Symbol.asyncIterator]();
async function ask(q: string): Promise<string> {
  process.stdout.write(q);
  const next = await lines.next();
  if (next.done) process.exit(0);
  return next.value;
}

// What the patient started, like the app's memory.requests: most often, then most recent, first.
let requests = new Map<string, { n: number; last: number; cat: StartCategory }>();
function requested(text: string, cat: StartCategory = "say") {
  requests.set(text, { n: (requests.get(text)?.n ?? 0) + 1, last: Date.now(), cat });
  history.push({ role: "patient", text });
}
const pastRequests = (cat: StartCategory) =>
  [...requests]
    .filter(([, r]) => r.cat === cat)
    .sort((a, b) => b[1].n - a[1].n || b[1].last - a[1].last)
    .map(([text, r]) => ({ text, n: r.n, agoMin: Math.round((Date.now() - r.last) / 60000) }));
const nowLabel = () => new Date().toLocaleString("en-US", { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });

async function show(inp: RepliesInput) {
  lastPrompt = buildRepliesPrompt(inp);
  const t0 = Date.now();
  const r = await getReplies(inp);
  const flags = [
    r.source,
    `${Date.now() - t0} ms`,
    r.highStakes ? `HIGH STAKES about: ${r.about ?? "?"}` : "",
    r.addressed ? "" : "NOT ADDRESSED",
    r.speaker ? `speaker: ${r.speaker.label} (${r.speaker.role})` : "",
  ];
  console.log(`  [${flags.filter(Boolean).join(" | ")}]`);
  r.options.forEach((o, i) => console.log(`  ${i + 1}. ${o.text}${o.intent ? `  (${o.intent})` : ""}`));
  return r;
}

// The app's Start screen: a category, then its phrases three at a time beside "None of these". The
// order is set once, so "n" pages on and nothing comes back; past the end the app opens Spell it.
async function start() {
  const c = (await ask("category (1 I need something, 2 I want to ask or say)> ")).trim();
  const category: StartCategory | null = c === "1" ? "need" : c === "2" ? "say" : null;
  if (!category) return;
  const past = pastRequests(category);
  const inp = { category, candidates: startCandidates(category, past), history, patientProfile, pastRequests: past, now: nowLabel() };
  lastPrompt = buildStartersPrompt(inp);
  const t0 = Date.now();
  let r;
  try { r = await getStarters(inp); } catch (e: any) { console.log("ERR", e?.status ?? "", e?.message); return; }
  console.log(`  [${r.source} | ${Date.now() - t0} ms]`);
  for (let at = 0; at < r.starters.length; at += 3) {
    const page = r.starters.slice(at, at + 3);
    page.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
    const pick = (await ask(`patient (1-${page.length}, n, Enter)> `)).trim().toLowerCase();
    if (page[Number(pick) - 1]) return requested(page[Number(pick) - 1], category);
    if (pick !== "n") return;
  }
  console.log("  (nothing left: the app opens Spell it)");
}

console.log(`model ${MODEL}. Type what the nurse says, or /start; /quit to leave.`);
for (;;) {
  const line = (await ask("\nnurse> ")).trim();
  if (!line) continue;
  if (line === "/quit") break;
  if (line === "/reset") { history = []; requests = new Map(); console.log("history and requests cleared"); continue; }
  if (line === "/prompt") { console.log(lastPrompt || "(nothing sent yet)"); continue; }
  if (line === "/start") { await start(); continue; }
  if (line.startsWith("/patient ")) { history.push({ role: "patient", text: line.slice(9).trim() }); continue; }

  // Same flow as patient.html: 1st "none" re-asks with what was shown, 2nd picks a topic.
  let inp: RepliesInput = { transcript: line, history, patientProfile };
  for (let nones = 0; ; ) {
    let r;
    try { r = await show(inp); } catch (e: any) { console.log("ERR", e?.status ?? "", e?.message); break; }
    const pick = (await ask("patient (1-3, n, Enter)> ")).trim().toLowerCase();
    if (/^[1-3]$/.test(pick)) {
      history.push({ role: "nurse", text: line, ...(r.speaker ? { speaker: r.speaker.label } : {}) });
      history.push({ role: "patient", text: r.options[Number(pick) - 1].text });
      break;
    }
    if (pick !== "n") break;
    if (++nones === 1) { inp = { ...inp, rejected: r.replies }; continue; }
    if (nones === 2) {
      const c = (await ask(`topic (${CATEGORIES.map((x, i) => `${i + 1} ${x}`).join(", ")})> `)).trim();
      const category = CATEGORIES[Number(c) - 1] ?? CATEGORIES.find((x) => x === c);
      if (!category) break;
      inp = { ...inp, rejected: r.replies, category };
      continue;
    }
    console.log("  (third none: the nurse asks a different question)");
    break;
  }
}
rl.close();
