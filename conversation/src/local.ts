// TESTING ONLY. Replies and Spell it word suggestions from a small model on this laptop, used when
// the caregiver turns on "Fast replies on this laptop (testing only)" in the app's care panel. Not
// for patients and not part of the demo: CLAUDE.md cuts a local LLM, and Noel kept this switch for
// testing. Qwen3-4B-Instruct (4-bit GGUF, `npm run local-model`) runs on the Apple GPU through
// node-llama-cpp (an optional dependency), loaded once and kept in memory. Prompts and schemas come
// from claude.ts, so both paths ask for the same thing.
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
    const context = await model.createContext({ contextSize: 4096 });
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

// JSON matching `schema`, generated under a grammar so it always parses.
export function localJson<T>(system: string, schema: object, user: string): Promise<T> {
  const run = async (): Promise<T> => {
    const { mod, llama, sequence } = await load();
    // The schemas in claude.ts are plain JSON Schema objects; node-llama-cpp's grammar type is a
    // stricter mirror of the same shape, so the cast only bridges the two type definitions.
    const grammar = await llama.createGrammarForJsonSchema(schema as Parameters<typeof llama.createGrammarForJsonSchema>[0]);
    const session = new mod.LlamaChatSession({ contextSequence: sequence, systemPrompt: system });
    try {
      return grammar.parse(await session.prompt(user, { grammar, maxTokens: 400 })) as T;
    } finally {
      session.dispose({ disposeSequence: false });
    }
  };
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}
