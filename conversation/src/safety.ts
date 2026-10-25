// Hard-coded, never model-generated. The patient screen always shows these.
export const URGENT = ["I'm in pain", "I can't breathe", "Call the nurse"];

export const SPELL_OPTION = "None of these, I'll spell it";

// Consent / treatment questions get yes / no / explain only.
const CONSENT_RE =
  /\b(consent|agree to|okay with|permission|surgery|surgical|procedure|operat(e|ion)|intubat\w*|extubat\w*|ventilat\w*|resuscitat\w*|cpr|dnr|do not resuscitate|code status|sedat\w*|anesthe\w*|transfus\w*|feeding tube|life support|comfort care|hospice|amputat\w*|biopsy|dialysis|chemo\w*|medication|treatment)\b/i;

// High stakes: the UI asks for a second confirm before speaking (CLAUDE.md contract).
export const CONSENT_REPLIES = ["Yes", "No", "I need more time"];

// "None of these" on a high-stakes question: questions and requests that never make the decision, so
// the answer can't become a reworded yes or no. One set per re-ask.
export const CLARIFY_REPLIES = [
  [{ text: "Please explain it again", intent: "explain" }, { text: "I have a question", intent: "question" }, { text: "Ask my family first", intent: "family" }],
  [{ text: "What are the risks?", intent: "risks" }, { text: "What if I say no?", intent: "if-no" }, { text: "I want to talk to the doctor", intent: "doctor" }],
];

// When the model doesn't answer: replies that fit the kind of thing said, never a guess at what it was
// about. Spare ones fill in for any the patient already rejected; there are enough for a first try and
// both "None of these" re-asks to fail and still show three new replies each.
const r = (text: string, intent: string) => ({ text, intent });
export const FALLBACK_REPLIES = {
  yesNo: [r("Yes", "yes"), r("No", "no"), r("Please ask again", "repeat")],
  open: [r("Please ask again", "repeat"), r("Ask me yes or no", "yes-no"), r("I'm not sure", "unsure")],
  statement: [r("Okay", "ok"), r("I have a question", "question"), r("Please say that again", "repeat")],
};
export const FALLBACK_SPARE = [
  r("Ask me yes or no", "yes-no"), r("I'm not sure", "unsure"), r("Give me a moment", "wait"),
  r("Please say that again", "say-again"), r("I have a question", "question"), r("Please explain more", "explain"),
  r("I'm too tired now", "tired"), r("Come back later", "later"),
];

// The last clause decides: "Oh no, what kept you up?" is open; "…, and are you hungry?" is yes/no.
export function questionKind(transcript: string): keyof typeof FALLBACK_REPLIES {
  const clauses = transcript.split(/[.!?,;:]/).map((c) => c.trim()).filter(Boolean);
  const last = (clauses.at(-1) ?? "").replace(/^(and|but|so|ok|okay|oh|well|now)\s+/i, "");
  if (/^(where|what|which|who|whom|whose|when|why|how)\b/i.test(last)) return "open";
  if (/^(do|does|did|are|is|was|were|am|can|could|will|would|have|has|had|should|shall|may|might|want|need|any)\b/i.test(last)) return "yesNo";
  return transcript.trim().endsWith("?") ? "yesNo" : "statement";
}

export function isConsentQuestion(transcript: string): boolean {
  return CONSENT_RE.test(transcript);
}
