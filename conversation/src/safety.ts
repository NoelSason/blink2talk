// Hard-coded, never model-generated. The patient screen always shows these.
export const URGENT = ["I'm in pain", "I can't breathe", "Call the nurse"];

export const SPELL_OPTION = "None of these, I'll spell it";

// Consent / treatment questions get yes / no / explain only.
const CONSENT_RE =
  /\b(consent|agree to|okay with|permission|surgery|surgical|procedure|operat(e|ion)|intubat\w*|extubat\w*|ventilat\w*|resuscitat\w*|cpr|dnr|do not resuscitate|code status|sedat\w*|anesthe\w*|transfus\w*|feeding tube|life support|comfort care|hospice|amputat\w*|biopsy|dialysis|chemo\w*|medication|treatment)\b/i;

// High stakes: the UI asks for a second confirm before speaking (CLAUDE.md contract).
export const CONSENT_REPLIES = ["Yes", "No", "I need more time"];

export function isConsentQuestion(transcript: string): boolean {
  return CONSENT_RE.test(transcript);
}
