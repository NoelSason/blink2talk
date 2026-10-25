// The contract between this server and the patient screen. One request produces one Board: a
// complete, already-positioned set of four boxes that the app renders verbatim. The app never ranks,
// never places, and never decides what the escape box is.

/** What the nurse's turn was, which decides the slot structure. See `slots.ts`. */
export type TurnType = "polar" | "wh" | "alternative" | "informing" | "procedure" | "consent";

/** Reading order, matching the app's GRID. NOT the vision module's clockwise order — see layout.ts. */
export type Position = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

/**
 * What a box is for. The model never emits these: the server assigns them from the slot table, so a
 * box's meaning is always known even when the text inside it came from a model.
 */
export type Role =
  | "affirm" | "refuse" | "qualify"          // polar
  | "guess"                                   // wh
  | "optionA" | "optionB" | "neither"         // alternative
  | "receipt" | "thanks" | "followup"         // informing
  | "halt" | "proceed" | "hurts"              // procedure
  | "explain"                                 // consent
  | "need" | "ask" | "alert"                  // idle
  | "escape" | "retract" | "spell" | "more";

/**
 * - speak:    say `say` aloud in the patient's voice
 * - open:     fetch the board named by `openId`; never used for "back" (that is a double blink)
 * - announce: `say` was filled in by the server (the clock, the chart), not the patient. Still spoken.
 * - alert:    speak AND raise the nurse signal. Only on hard-coded urgent boxes.
 * - spell:    open the composer
 * - retract:  take back what was just said
 */
export type Act = "speak" | "open" | "announce" | "alert" | "spell" | "retract";

/** Where a box's text came from. Surfaced so the care panel can show what was generated. */
export type Source = "fixed" | "template" | "model" | "memory" | "clock";

export interface Slot {
  position: Position;
  /** 1..3 for content, 99 for the escape. Rank decides position; see `place()`. */
  rank: number;
  role: Role;
  /** What the patient reads. At most MAX_LABEL_WORDS words. */
  label: string;
  /** What is spoken, when it differs from the label. */
  say?: string;
  act: Act;
  openId?: string;
  source: Source;
  icon?: string;
}

export type BoardKind = "responding" | "idle" | "drill" | "confirm" | "retract";

export interface Board {
  boardId: string;
  /** Set only on boards that answer a nurse turn. */
  turnId: string | null;
  kind: BoardKind;
  turnType: TurnType | null;
  /** Goes in the centre rest circle: the only place the patient can look without consequence. */
  caption: { speaker: "nurse" | "system"; text: string } | null;
  /** 2 when degraded, 3 normally. The escape is not counted. */
  contentBoxes: number;
  /** ALWAYS length 4, in reading order. null is an empty cell. */
  slots: (Slot | null)[];
  /** When true, selecting a slot returns a confirm board instead of speaking. */
  confirm: boolean;
  /** Which board a double blink returns to, for drill-downs. */
  backTo?: string;
  ms: Partial<{ stt: number; classify: number; prefill: number; gen: number; total: number }>;
  source: string;
}

/** From the vision module, passed in by the app. The server never sees camera frames. */
export type FatigueLevel = "baseline" | "normal" | "elevated";

/**
 * Per-target calibration accuracy, 0..1, as `QuadrantCalibration.accuracy` reports it. Used only to
 * decide whether the weak bottom row is trustworthy enough to hold content.
 */
export type Accuracy = Partial<Record<Position | "center", number>>;

export interface PlaceOptions {
  fatigue?: FatigueLevel;
  accuracy?: Accuracy;
}
