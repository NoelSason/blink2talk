export {}; // top-level await needs this file to be a module

// Build-step-1 measurement spike. `npm run bench`
//
// Every latency number in the plan is an estimate until this runs. It measures the four things that
// decide whether a local model is usable here, and prints a go/no-go.
//
// Point it at whichever Ollama is serving:
//   LLM_URL=http://localhost:11434            # Windows Ollama, via mirrored WSL networking
//   LLM_MODEL=qwen3:4b                        # or a Modelfile wrapping Noel's exact GGUF
//
// Matching conversation/src/local.ts's weights (Qwen3-4B-Instruct-2507-Q4_K_M) makes these numbers
// comparable to the 0.85 s median measured on the Mac.

const BASE = process.env.LLM_URL ?? "http://localhost:11434";
const MODEL = process.env.LLM_MODEL ?? "qwen3:4b-instruct-2507-q4_K_M";

interface GenResult {
  response: string;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
  total_duration?: number;
}

async function gen(prompt: string, opts: Record<string, unknown> = {}): Promise<GenResult> {
  const res = await fetch(`${BASE}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      raw: true,
      stream: false,
      keep_alive: "30m",
      options: { temperature: 0.3, num_predict: 24, ...opts },
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<GenResult>;
}

const ns = (n: number | undefined) => (n ?? 0) / 1e6; // ns -> ms
const rate = (count: number | undefined, dur: number | undefined) =>
  count && dur ? (count / (dur / 1e9)).toFixed(1) : "?";

const filler = (words: number) =>
  Array.from({ length: words }, (_, i) => `note ${i} the patient rested quietly`).join(". ");

console.log(`bench: ${MODEL} at ${BASE}\n`);

// --- 0. reachable, and cold-load cost -------------------------------------------------
let t0 = Date.now();
try {
  await gen("hello", { num_predict: 1 });
} catch (err) {
  console.error(`cannot reach ${BASE}: ${(err as Error).message}`);
  console.error(`\nIs Ollama running? On Windows it serves at localhost:11434 and WSL reaches it`);
  console.error(`directly because .wslconfig has networkingMode=mirrored.`);
  process.exit(1);
}
const coldMs = Date.now() - t0;
console.log(`0. cold load + first token     ${coldMs} ms`);

// --- 1. prefill and generation rates --------------------------------------------------
const long = `${filler(260)}\n\nNurse: are you in pain\n`;
const r1 = await gen(long, { num_predict: 24 });
const prefillRate = Number(rate(r1.prompt_eval_count, r1.prompt_eval_duration));
const genRate = Number(rate(r1.eval_count, r1.eval_duration));
console.log(`1. prefill                     ${prefillRate} tok/s  (${r1.prompt_eval_count} tokens, ${ns(r1.prompt_eval_duration).toFixed(0)} ms)`);
console.log(`   generation                  ${genRate} tok/s  (${r1.eval_count} tokens, ${ns(r1.eval_duration).toFixed(0)} ms)`);

// --- 2. THE HARD GATE: does the prefix cache actually engage? -------------------------
// The whole design rests on prefilling a ~1000-token prefix while the nurse holds the PTT key, so
// that key-up only pays for the transcript. If re-sending the same prefix re-evaluates every token,
// every turn costs the full prefill and this approach is dead. Check before building on it.
await gen(long, { num_predict: 1 });
const r2 = await gen(`${long}Nurse: are you cold\n`, { num_predict: 8 });
const reused = (r1.prompt_eval_count ?? 0) - (r2.prompt_eval_count ?? 0);
const cacheWorks = (r2.prompt_eval_count ?? 1e9) < (r1.prompt_eval_count ?? 0) / 2;
console.log(`2. prefix cache                ${cacheWorks ? "REUSED" : "NOT REUSED"}  (${r1.prompt_eval_count} tokens cold -> ${r2.prompt_eval_count} warm)`);
if (!cacheWorks) {
  console.log(`   ^^ HARD GATE FAILED. Without prefix reuse every turn pays the full prefill`);
  console.log(`      (~${(((r1.prompt_eval_count ?? 0) / prefillRate) * 1000).toFixed(0)} ms). Redesign before building further.`);
}

// --- 3. the shapes we actually ask for ------------------------------------------------
// Pipe-delimited, not JSON: on a slow local model the ~14 tokens of JSON scaffolding are latency,
// and pipes let the first box paint as soon as the first separator arrives.
const SYSTEM = `Label what the nurse said with one letter, then fill only the spans that letter needs.
R  something is about to be done to the patient's body
I  informing - a statement, not a question
C  consent or a treatment decision
P  polar question - the answer is yes or no
A  a choice between named options
W  open question - what, where, when, who, why, how

R
I|<a short question the patient would ask next>
C
P|<the likeliest specific answer, 2-4 words>
A|<option one>|<option two>
W|<guess>|<guess>|<guess>

Patient's voice, lower case, no quotes, no full stop.

Nurse: i'm going to suction you now
R
Nurse: your daughter is coming at six
I|is she bringing the baby
Nurse: are you in pain
P|its my back
Nurse: how are you feeling this morning
W|tired|my throat hurts|i want to sit up
`;

const PROBES: [string, string][] = [
  ["are you thirsty", "P"],
  ["i'm just going to turn you over", "R"],
  ["we need your consent for the line", "C"],
  ["your son called this morning", "I"],
  ["do you want tea or water", "A"],
  ["where does it hurt", "W"],
];

console.log(`\n3. output shape and latency`);
let parseable = 0;
let labelled = 0;
const totals: number[] = [];
for (const [phrase, want] of PROBES) {
  const t = Date.now();
  const r = await gen(`${SYSTEM}Nurse: ${phrase}\n`, { num_predict: 24, stop: ["\nNurse:"] });
  const ms = Date.now() - t;
  totals.push(ms);
  const out = r.response.trim().split("\n")[0] ?? "";
  const got = out[0] ?? "?";
  const ok = /^[RICPAW](\|[^|]+)*$/.test(out);
  if (ok) parseable++;
  if (got === want) labelled++;
  console.log(`   ${ok ? "ok  " : "BAD "} ${want} ${got === want ? "==" : "!="} ${got}  ${String(ms).padStart(5)} ms  ${JSON.stringify(out).slice(0, 56)}`);
}

const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;
const med = median(totals);

console.log(`\n${"=".repeat(64)}`);
console.log(`prefill ${prefillRate} tok/s · generation ${genRate} tok/s · cache ${cacheWorks ? "reused" : "NOT REUSED"}`);
console.log(`format parseable ${parseable}/${PROBES.length} · label correct ${labelled}/${PROBES.length}`);
console.log(`median turn ${med} ms  (cold load ${coldMs} ms, excluded)`);
console.log(`\nfor comparison: conversation/src/local.ts measures 0.85 s median on the Mac's GPU.`);

// --- go / no-go -----------------------------------------------------------------------
const problems: string[] = [];
if (!cacheWorks) problems.push("prefix cache does not reuse — the PTT prefill trick is unavailable");
if (genRate < 10) problems.push(`generation ${genRate} tok/s is under 10 — try a 1.5B, or move to the GPU`);
if (parseable < PROBES.length * 0.85) problems.push(`format compliance ${parseable}/${PROBES.length} is under 85% — constrain with a grammar`);
if (med > 2500) problems.push(`median turn ${med} ms is over the 2500 ms gate`);

console.log(`\n${problems.length ? "NO-GO:" : "GO."}`);
for (const p of problems) console.log(`  - ${p}`);
if (!problems.length) console.log(`  all four gates clear. Build the adapter against these numbers.`);
process.exitCode = problems.length ? 1 : 0;
