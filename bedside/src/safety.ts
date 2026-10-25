// Things a model is never allowed to decide.
//
// DUPLICATED FROM conversation/src/safety.ts, deliberately. This module is independent of the
// conversation server: it must keep working with that directory deleted. The cost is that these two
// files can drift. If you change one, change the other, and say so in both context docs.

/** Hard-coded, never model-generated. A model that is down, slow or wrong must not cost someone air. */
export const URGENT = ["I'm in pain", "I can't breathe", "Call the nurse"];

// Consent / treatment questions never reach a model at all: they short-circuit to fixed replies and
// a second confirm. Matching too much is safe here (a yes/no board is a fine answer to most
// questions); matching too little is not.
const CONSENT_RE =
  /\b(consent|agree to|okay with|permission|surgery|surgical|procedure|operat(e|ion)|intubat\w*|extubat\w*|ventilat\w*|resuscitat\w*|cpr|dnr|do not resuscitate|code status|sedat\w*|anesthe\w*|transfus\w*|feeding tube|life support|comfort care|hospice|amputat\w*|biopsy|dialysis|chemo\w*|medication|treatment)\b/i;

/**
 * Yes / No / Explain more, per references/quadrant-content.md. Note this differs from CLAUDE.md,
 * which specifies "I need more time" as the third option; the conversation server also ships
 * "Explain more". Worth settling with the team.
 */
export const CONSENT_REPLIES = ["Yes", "No", "Explain more"];

export function isConsentQuestion(transcript: string): boolean {
  return CONSENT_RE.test(transcript);
}

// Spans a model produced never reach a box if they look like a clinical claim. The patient has not
// signalled a dose, a drug or a code status, and the box is spoken aloud in their own voice.
const DENY_RE = /\b(mg|mcg|ml|units?|dnr|do not resuscitate|morphine|fentanyl|propofol|midazolam|heparin|insulin|epinephrine|norepinephrine|vanco\w*|antibiotic)\b|\d/i;

/** True when a model-generated span must be dropped in favour of a template. */
export function denied(span: string): boolean {
  return DENY_RE.test(span);
}
