import type { PastRequest, StartCategory } from "./claude.js";

type Opt = { text: string; intent: string };
const o = (text: string, intent: string): Opt => ({ text, intent });

const BY_CATEGORY: Record<string, Opt[]> = {
  pain: [o("My chest hurts", "chest"), o("My back hurts", "back"), o("I need pain medicine", "relief")],
  comfort: [o("I'm thirsty", "water"), o("Please move me", "reposition"), o("I'm cold", "cold")],
  people: [o("Where is my family?", "family"), o("Please call my wife", "call"), o("I want to be alone", "privacy")],
  question: [o("What is happening?", "what"), o("How long will I be here?", "how-long"), o("When can I eat?", "eat")],
};

// Always exactly 3, like the real model.
export function mockReplies(transcript: string, category?: string): Opt[] {
  if (category && BY_CATEGORY[category]) return BY_CATEGORY[category];
  const t = transcript.toLowerCase();
  if (/thirst|water|drink/.test(t)) return [o("Yes, water please", "yes"), o("No, I'm fine", "no"), o("Just ice chips", "ice")];
  if (/pain|hurt/.test(t)) return [o("Yes, a lot", "yes"), o("No pain", "no"), o("Only a little", "mild")];
  if (/comfortable|position|pillow/.test(t)) return [o("Yes", "yes"), o("No", "no"), o("Raise my head", "raise-head")];
  return [o("Yes", "yes"), o("No", "no"), o("Please say that again", "repeat")];
}

// "I want to say something": each category's common phrases, most wanted first. Needs from the doc's
// idle board plus suction; questions and feelings so that orientation, fear and closeness are two picks
// away (references/quadrant-content.md). Keep in step with START_LISTS in app/renderer/conversation.js.
export const START_LISTS: Record<StartCategory, string[]> = {
  need: ["I'm thirsty", "Move me, please", "I need suctioning", "I'm cold", "I need the bathroom", "I want to sleep", "The light hurts", "I'm too hot", "It's too loud"],
  say: ["What time is it?", "I'm scared", "Tell them I love them", "I want to see my family", "Don't leave", "How long have I been here?", "Where am I?", "What happened to me?", "Thank you"],
};

/** A category's items: past requests in it first (already ranked), then its common phrases. */
export function startCandidates(category: StartCategory, past: PastRequest[] = []): string[] {
  const seen = new Set<string>();
  return [...past.map((p) => p.text), ...START_LISTS[category]].filter((t) => {
    const k = t.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function mockComplete(prefix: string): string[] {
  const words = ["water", "wife", "warm", "wait", "want", "pillow", "pain", "please", "phone", "turn"];
  return words.filter((w) => w.startsWith(prefix.toLowerCase())).slice(0, 4);
}
