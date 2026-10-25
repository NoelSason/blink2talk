// The slot table: what the three content boxes are for, per kind of nurse turn.
//
// This is the executable form of references/quadrant-content.md § "Responding — typed by the first
// pair part". The point is that we do NOT generate "the three most likely replies". We work out what
// kind of turn the nurse took, and that decides the structure; only the marked slots need any text
// generated at all.
//
// Two rows carry rules that are easy to lose:
//
//   polar      "No, not right now" is PRE-ACCOUNTED. In speech, refusing is normally hedged and
//              given a reason ("no, not right now, I just..."). That is free to say and costs a
//              patient here 2.3 s per extra selection, on top of the documented acquiescence bias in
//              people with communication impairment. If refusal costs more than agreement, the
//              interface manufactures consent. The account goes in the box.
//
//   procedure  "Wait" is the patient's only way to halt something being done to their body, so it
//              goes top-left: the most reliable target on the board.

import type { Role, Source, TurnType } from "./types.js";

/** One content box in the table. `generated` slots get their text from the model (or a fallback). */
export interface SlotTemplate {
  role: Role;
  /** Fixed text, or the fallback used when generation fails or is disabled. */
  label: string;
  /** When true the label above is only a fallback; normally the model fills this box. */
  generated?: boolean;
  source: Source;
}

/** Ranked best-first. Rank decides position in `place()`; this table never names a corner. */
export const SLOT_TABLE: Record<TurnType, SlotTemplate[]> = {
  // "Are you in pain?"
  polar: [
    { role: "affirm", label: "Yes", source: "template" },
    { role: "refuse", label: "No, not right now", source: "template" },
    { role: "qualify", label: "Sort of", generated: true, source: "template" },
  ],

  // "How are you feeling?" — the expensive row: three spans, and the only one that needs streaming.
  wh: [
    { role: "guess", label: "I'm tired", generated: true, source: "template" },
    { role: "guess", label: "I'm uncomfortable", generated: true, source: "template" },
    { role: "guess", label: "I want to sit up", generated: true, source: "template" },
  ],

  // "Tea or water?" — the options are usually extractable from the nurse's own words.
  alternative: [
    { role: "optionA", label: "The first one", generated: true, source: "template" },
    { role: "optionB", label: "The second one", generated: true, source: "template" },
    { role: "neither", label: "Neither", source: "template" },
  ],

  // "Your daughter comes at six." Not a question. The correct reply is a news receipt, not an answer
  // to a question that was never asked — this is the row the current server gets most wrong, because
  // it fabricates an answer to a statement.
  informing: [
    { role: "receipt", label: "Okay", source: "template" },
    { role: "thanks", label: "Thank you", source: "template" },
    { role: "followup", label: "Tell me more", generated: true, source: "template" },
  ],

  // "I'm going to suction you." Zero generation: every box is fixed, so this is the fastest board in
  // the system, which is correct, because it is the one the patient most urgently needs.
  procedure: [
    { role: "halt", label: "Wait", source: "template" },
    { role: "proceed", label: "Okay, go ahead", source: "template" },
    { role: "hurts", label: "That hurts", source: "template" },
  ],

  // Never reaches a model. Yes and No split across the STRONG horizontal axis, because confusing
  // them is the most dangerous error the system can make, and the board asks for a second confirm.
  consent: [
    { role: "affirm", label: "Yes", source: "fixed" },
    { role: "refuse", label: "No", source: "fixed" },
    { role: "explain", label: "Explain more", source: "fixed" },
  ],
};

/** How many model-generated spans a turn type needs. 0 means the board is pure template. */
export const spanCount = (t: TurnType): number => SLOT_TABLE[t].filter((s) => s.generated).length;

/** Consent boards require a second confirm before anything is spoken. */
export const needsConfirm = (t: TurnType): boolean => t === "consent";
