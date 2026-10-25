// Boards that need no model at all.
//
// The idle board is the important one. Nurses start about 86% of ICU exchanges, and a screen that
// only fills in after someone speaks mechanises that: the patient can answer but never ask. So idle
// is not a waiting room, it is the patient's only way to start something, and all four of Light's
// purposes (needs/wants, information, social closeness, etiquette) have to be reachable within two
// selections from here.
//
// Idle and drill boards carry NO escape box. Their content is hand-authored rather than generated,
// so there is nothing to escape from, and the fourth cell is worth more as content. Back is always a
// double blink, never a box.

import { board, type SlotSpec } from "./layout.js";
import { SLOT_TABLE, needsConfirm } from "./slots.js";
import { URGENT } from "./safety.js";
import type { Board, PlaceOptions, TurnType } from "./types.js";

/** Facts the app or the chart already knows, so orientation needs no human and no model. */
export interface Orientation {
  /** Free text from memory.md's `## Orientation`, e.g. "St. Luke's, medical ICU, bed 4." */
  where?: string;
  /** e.g. "You had a valve repair on Thursday morning." */
  what?: string;
  /** e.g. "They plan to take the tube out tomorrow." */
  next?: string;
}

const clause = (s: string | undefined) => (s && s.trim() ? s.trim().replace(/\.?$/, ".") : "");

/**
 * The single best bits-per-second in the design: two selections buy a complete answer with no nurse
 * in the loop at all. Orientation is over half of what wake-up patients report wanting to ask, and
 * every part of the answer is already known to the app or the chart.
 */
export function orientationAnswer(now: Date, o: Orientation = {}): string {
  const day = now.toLocaleDateString("en-GB", { weekday: "long" });
  const time = now.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" });
  const partOfDay = now.getHours() < 12 ? "morning" : now.getHours() < 18 ? "afternoon" : "evening";
  return [`It's ${day} ${partOfDay}, ${time}.`, clause(o.where), clause(o.what), clause(o.next)]
    .filter(Boolean)
    .join(" ");
}

const alert = (label: string): SlotSpec => ({
  rank: 1,
  role: "alert",
  label,
  say: label,
  act: "alert",
  source: "fixed",
});

const opens = (label: string, openId: string, role: SlotSpec["role"] = "ask"): SlotSpec => ({
  rank: 1,
  role,
  label,
  act: "open",
  openId,
  source: "fixed",
});

const says = (label: string): SlotSpec => ({ rank: 1, role: "need", label, say: label, act: "speak", source: "fixed" });

/**
 * The patient's first-pair-part board. The two life-critical items are one selection; everything
 * else is two.
 */
export function idleBoard(opts: PlaceOptions = {}): Board {
  return board({
    kind: "idle",
    turnId: null,
    turnType: null,
    caption: null,
    confirm: false,
    ms: {},
    source: "fixed",
    opts,
    content: [
      { ...alert(URGENT[1] as string), icon: "wind" },        // I can't breathe
      { ...alert(URGENT[0] as string), icon: "bandage" },     // I'm in pain
      opens("I need something", "needs", "need"),
      opens("I want to ask or say", "say"),
    ],
  });
}

/** Two selections from idle must reach fear and closeness, not just thirst and position. */
function sayBoard(now: Date, o: Orientation, opts: PlaceOptions): Board {
  return board({
    kind: "drill",
    turnId: null,
    turnType: null,
    caption: { speaker: "system", text: "What do you want to say?" },
    confirm: false,
    backTo: "idle",
    ms: {},
    source: "fixed",
    opts,
    content: [
      {
        rank: 1,
        role: "ask",
        label: "What time is it?",
        say: orientationAnswer(now, o),
        act: "announce",
        source: "clock",
      },
      says("I'm scared"),
      says("Tell them I love them"),
      opens("More", "say-more", "more"),
    ],
  });
}

const BOARDS: Record<string, SlotSpec[]> = {
  needs: [says("I'm thirsty"), says("Move me, please"), says("I'm cold"), opens("More", "needs-more", "more")],
  "needs-more": [says("I need the bathroom"), says("I want to sleep"), says("The light hurts"), opens("Back to needs", "needs", "more")],
  "say-more": [
    says("I want to see my family"),
    says("Don't leave"),
    says("How long have I been here?"),
    { rank: 1, role: "spell", label: "Spell it", act: "spell", source: "fixed", icon: "keyboard" },
  ],
  // What "Not this" opens. The urgent options stay reachable, and a second escape reaches the composer.
  escape: [
    { ...alert(URGENT[0] as string), icon: "bandage" },
    { ...alert(URGENT[1] as string), icon: "wind" },
    { ...alert(URGENT[2] as string), icon: "bell" },
    { rank: 1, role: "spell", label: "Spell it", act: "spell", source: "fixed", icon: "keyboard" },
  ],
};

const CAPTIONS: Record<string, string> = {
  needs: "What do you need?",
  "needs-more": "What do you need?",
  "say-more": "What do you want to say?",
  escape: "None of those fit",
};

export function drillBoard(id: string, now: Date, o: Orientation, opts: PlaceOptions = {}): Board | null {
  if (id === "say") return sayBoard(now, o, opts);
  const content = BOARDS[id];
  if (!content) return null;
  return board({
    kind: "drill",
    turnId: null,
    turnType: null,
    caption: { speaker: "system", text: CAPTIONS[id] ?? "" },
    confirm: false,
    backTo: "idle",
    ms: {},
    source: "fixed",
    opts,
    content,
  });
}

/**
 * A board answering what the nurse just said. `spans` fills the generated slots in order; any that
 * are missing fall back to the template text, which is why this works with no model at all.
 */
export function respondingBoard(args: {
  turnId: string;
  turnType: TurnType;
  transcript: string;
  spans?: (string | undefined)[];
  ms?: Board["ms"];
  source?: string;
  opts?: PlaceOptions;
}): Board {
  const { turnId, turnType, transcript, spans = [], ms = {}, source = "template", opts = {} } = args;
  let fed = 0;
  const content: SlotSpec[] = SLOT_TABLE[turnType].map((tpl, i) => {
    const span = tpl.generated ? spans[fed++] : undefined;
    const label = span?.trim() || tpl.label;
    return {
      rank: i + 1,
      role: tpl.role,
      label,
      say: label,
      act: "speak",
      source: span?.trim() ? "model" : tpl.source,
    };
  });

  return board({
    kind: "responding",
    turnId,
    turnType,
    caption: { speaker: "nurse", text: transcript },
    confirm: needsConfirm(turnType),
    ms,
    source,
    opts,
    content,
  });
}
