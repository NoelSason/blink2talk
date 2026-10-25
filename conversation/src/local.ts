// TESTING ONLY. Replies and Spell it word suggestions from a small model on this laptop, used when
// the caregiver turns on "Fast replies on this laptop (testing only)" in the app's care panel. Not
// for patients and not part of the demo: CLAUDE.md cuts a local LLM, and Noel kept this switch for
// testing. Qwen3-4B-Instruct (4-bit GGUF, `npm run local-model`) runs on the Apple GPU through
// node-llama-cpp (an optional dependency), loaded once and kept in memory. Answers are short lists
// ("Yes | No | Not now"): writing tokens is what takes the time, and JSON spent ~10 of every 17 tokens
// on brackets and quotes. Measured on an M3 Max with the patient app open: median 87 ms per reply.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const LOCAL_MODEL = path.join(here, "../models/Qwen3-4B-Instruct-2507-Q4_K_M.gguf");
export const localModelAvailable = () => fs.existsSync(LOCAL_MODEL);

type NodeLlama = typeof import("node-llama-cpp");
type Loaded = {
  mod: NodeLlama;
  llama: Awaited<ReturnType<NodeLlama["getLlama"]>>;
  sequence: ReturnType<Awaited<ReturnType<Awaited<ReturnType<Awaited<ReturnType<NodeLlama["getLlama"]>>["loadModel"]>>["createContext"]>>["getSequence"]>;
};
let loading: Promise<Loaded> | null = null;

function load(): Promise<Loaded> {
  loading ??= (async () => {
    const mod = await import("node-llama-cpp");
    const llama = await mod.getLlama();
    const model = await llama.loadModel({ modelPath: LOCAL_MODEL });
    // Flash attention: ~10% faster here. Every layer already runs on the GPU (37 of 37).
    const context = await model.createContext({ contextSize: 2048, flashAttention: true });
    return { mod, llama, sequence: context.getSequence() };
  })();
  loading.catch(() => {
    loading = null; // try again on the next request
  });
  return loading;
}

// Load the model ahead of the first request (~2 s), when the switch is turned on.
export function warmLocal(): void {
  if (localModelAvailable()) load().catch((err) => console.error("local model didn't load:", err));
}

// One generation at a time: the model has a single context sequence.
let queue: Promise<unknown> = Promise.resolve();
// One grammar per list length, built once (building one per request cost ~0.3 s).
const grammars = new Map<number, ReturnType<Loaded["llama"]["createGrammar"]>>();

// Exactly `count` short items, separated by " | " and forced by a grammar so the answer always parses.
export function localList(system: string, user: string, count: number): Promise<string[]> {
  const run = async (): Promise<string[]> => {
    const { mod, llama, sequence } = await load();
    if (!grammars.has(count)) {
      const items = Array.from({ length: count }, () => "item").join(' " | " ');
      grammars.set(count, llama.createGrammar({ grammar: `root ::= ${items}\nitem ::= [^|\n]+` }));
    }
    const grammar = await grammars.get(count)!;
    const session = new mod.LlamaChatSession({ contextSequence: sequence, systemPrompt: system });
    try {
      const out = await session.prompt(user, { grammar, maxTokens: 20 * count });
      return out.split("|").map((s) => s.trim()).filter(Boolean);
    } finally {
      session.dispose({ disposeSequence: false });
    }
  };
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}
