// Where boxes go. This is the only file that assigns a position, and the model has no influence over
// it: position comes from rank alone, so the same kind of answer is always in the same corner and
// becomes muscle memory.
//
// Error cost is allocated inversely to target reliability. The vertical axis is the weak one (the
// lids drag vertical gaze features down during a hold), so the bottom row holds the cheapest content:
// the least-likely reply and the escape. A bottom-row mix-up swaps those two, the cheapest confusion
// available. A top-row mix-up would swap the two likeliest answers, which is the expensive one.

import type { Accuracy, Board, BoardKind, PlaceOptions, Position, Slot } from "./types.js";

/**
 * Reading order, matching the app's GRID in app/renderer/app.js.
 *
 * The vision module's QUADRANTS is CLOCKWISE (topLeft, topRight, bottomRight, bottomLeft). These two
 * orders agree on indices 0 and 1 and disagree on 2 and 3, so a mix-up silently swaps the
 * least-likely reply with the escape and nothing crashes. Convert with `slotIndex`, never by
 * assuming the orders match. `test/layout.test.ts` asserts they are a permutation of each other and
 * are not equal.
 */
export const SLOT_ORDER = ["topLeft", "topRight", "bottomLeft", "bottomRight"] as const;

export const slotIndex = (p: Position): number => SLOT_ORDER.indexOf(p);

/** The escape lives here on every responding board and never moves. */
export const ESCAPE_POSITION: Position = "bottomRight";

/**
 * Boxes are read from a hospital bed, often without glasses, at 1280×800 in the worst case. A box is
 * then about 560 px wide, reply text is ~52 px semibold, so roughly 20 characters fit on a line and
 * the brief allows two lines without truncating.
 *
 * The cap is on CHARACTERS, not words, because characters are what actually wrap: "I want to ask or
 * say" is six short words but only 20 characters, while a five-word phrase of long words is wider.
 */
export const MAX_LABEL_CHARS = 32;

/** Below this per-target calibration accuracy, the bottom-left box is not trusted with content. */
export const DEGRADE_ACC = 0.8;

/** A slot before it has been given a position. */
export type SlotSpec = Omit<Slot, "position">;

export const labelWidth = (s: string): number => s.trim().length;

/** The fixed escape box. Never model-generated, offered on every responding board. */
export const escapeSlot = (): SlotSpec => ({
  rank: 99,
  role: "escape",
  label: "Not this",
  act: "open",
  openId: "escape",
  source: "fixed",
});

/**
 * Should the weak bottom-left box hold content right now?
 *
 * Degrade DOWN, not sideways: when the patient is tiring or the bottom row calibrated badly, drop to
 * two content boxes on the strong top row. Never shrink to three by dropping the escape — a board
 * with no visible exit is the standard AAC failure, where the patient takes the nearest wrong
 * sentence and it is spoken aloud in their own voice.
 */
export function bottomLeftUsable(opts: PlaceOptions = {}): boolean {
  if (opts.fatigue === "elevated") return false;
  const acc: Accuracy = opts.accuracy ?? {};
  const bottomLeft = acc.bottomLeft;
  if (typeof bottomLeft === "number" && Number.isFinite(bottomLeft) && bottomLeft < DEGRADE_ACC) return false;
  return true;
}

/**
 * Lay content out by rank and return the four cells in reading order.
 *
 * `content` is ranked best-first and must already be validated (see `validate.ts`): `place` will not
 * invent a replacement for an over-long label, it throws, because a box the patient cannot read is a
 * bug upstream rather than something to paper over here.
 *
 * Responding boards always get the escape at bottomRight. Idle and drill boards get four content
 * boxes and NO escape: their content is hand-authored rather than generated, so there is nothing to
 * escape from, and the fourth box is worth more as content. Do not "fix" this.
 */
export function place(
  kind: BoardKind,
  content: SlotSpec[],
  opts: PlaceOptions = {},
): { slots: (Slot | null)[]; contentBoxes: number } {
  const wantsEscape = kind === "responding";
  const capacity = wantsEscape ? 3 : 4;

  for (const spec of content) {
    if (labelWidth(spec.label) > MAX_LABEL_CHARS) {
      throw new Error(`label too long (${labelWidth(spec.label)} chars, max ${MAX_LABEL_CHARS}): ${JSON.stringify(spec.label)}`);
    }
  }
  if (content.length > capacity) {
    throw new Error(`${kind} board holds ${capacity} content boxes, got ${content.length}`);
  }

  const usable = wantsEscape && !bottomLeftUsable(opts) ? Math.min(content.length, 2) : content.length;
  const slots: (Slot | null)[] = [null, null, null, null];

  content.slice(0, usable).forEach((spec, i) => {
    const position = SLOT_ORDER[i] as Position;
    slots[i] = { ...spec, position, rank: spec.rank || i + 1 };
  });

  if (wantsEscape) {
    slots[slotIndex(ESCAPE_POSITION)] = { ...escapeSlot(), position: ESCAPE_POSITION };
  }

  return { slots, contentBoxes: usable };
}

let boardCounter = 0;
export const nextBoardId = (): string => `b_${(++boardCounter).toString(36)}_${Date.now().toString(36)}`;

/** Assemble a Board around a laid-out set of slots. */
export function board(
  init: Omit<Board, "boardId" | "slots" | "contentBoxes"> & { content: SlotSpec[]; opts?: PlaceOptions },
): Board {
  const { content, opts, ...rest } = init;
  const { slots, contentBoxes } = place(rest.kind, content, opts);
  return { boardId: nextBoardId(), slots, contentBoxes, ...rest };
}
