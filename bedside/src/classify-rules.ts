// Working out what kind of turn the nurse took, without a model where possible.
//
// On this hardware a model call costs several hundred milliseconds even for a single token, so the
// model is the tie-breaker, not the classifier. These rules are written for PRECISION: each one
// either fires confidently or abstains. `confident: false` means "ask the model", not "probably
// polar".
//
// Accuracy matters unevenly. Mislabelling `wh` as `polar` costs one escape and a round trip.
// Mislabelling `procedure` as `informing` costs the patient their only way to say "Wait" while
// something is done to their body. The procedure rule is therefore the broadest of the specific ones.

import { isConsentQuestion } from "./safety.js";
import type { TurnType } from "./types.js";

export interface RuleResult {
  type: TurnType;
  confident: boolean;
  why: string;
}

/** "I'm going to...", "we're about to...", "I need to..." — something is about to happen to them. */
const PROCEDURE_INTENT = /\b(i'?m|we'?re|i am|we are|they'?re|they are)\s+(just\s+)?(going to|about to|gonna)\b|\bi need to\b|\blet me\b|\bi'?ll\s+(just\s+)?/i;
const PROCEDURE_VERB =
  /\b(suction|turn|move|roll|clean|change|draw|stick|poke|flush|check|reposition|lift|wash|shave|tape|remove|place|sit you|lie you|put you|take out|pull|insert|adjust|wipe|dress|bathe)\b/i;

/**
 * A wh-word opening the sentence, or opening a clause after a comma: "On a scale of one to ten, how
 * bad is the pain?" is a wh-question wearing a prepositional phrase. Deliberately does NOT match a
 * wh-word mid-clause, because "Do you know where you are?" really is polar — the answer is yes or no.
 */
const WH_OPEN = /(^|,\s*)(what|where|when|who|whom|why|how|which)\b/i;
const POLAR_OPEN =
  /^\s*(do|does|did|are|is|was|were|am|can|could|will|would|have|has|had|should|shall|may|might|must)\b/i;

/** " or " offering a choice, not "either/or" and not sentence-initial. */
const ALTERNATIVE = /\S\s+or\s+\S/i;

const hasQuestionMark = (s: string) => s.includes("?");

export function classifyByRules(transcript: string): RuleResult {
  const t = transcript.trim();

  // Safety first: consent never reaches a model, so this rule outranks everything including shape.
  if (isConsentQuestion(t)) return { type: "consent", confident: true, why: "consent regex" };

  // Before the question tests: "I'm going to suction you, okay?" is a procedure announcement wearing
  // a question mark, and the patient needs "Wait" far more than they need yes/no.
  if (PROCEDURE_INTENT.test(t) && PROCEDURE_VERB.test(t)) {
    return { type: "procedure", confident: true, why: "first-person-future + procedure verb" };
  }

  if (WH_OPEN.test(t)) {
    // "What time is it or should I come back later" is vanishingly rare; wh wins.
    return { type: "wh", confident: true, why: "opens with a wh-word" };
  }

  if (ALTERNATIVE.test(t) && (hasQuestionMark(t) || POLAR_OPEN.test(t))) {
    return { type: "alternative", confident: true, why: "question offering 'x or y'" };
  }

  if (POLAR_OPEN.test(t)) {
    return { type: "polar", confident: true, why: "opens with an auxiliary verb" };
  }

  if (hasQuestionMark(t)) {
    // A question that fits no pattern above. Yes/No/qualifier is a reasonable board for almost any
    // question, so this is a safe default rather than a guess worth paying a model for.
    return { type: "polar", confident: true, why: "question mark, no wh- or choice" };
  }

  // A declarative. Usually informing ("your daughter comes at six"), but this is the lowest-precision
  // case in the set and the one genuinely worth a model call: it is where procedure announcements
  // without a tell-tale verb, and polar questions spoken flat without a question mark, both land.
  return { type: "informing", confident: false, why: "declarative, no other rule fired" };
}
