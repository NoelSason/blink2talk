import { describe, expect, it } from "vitest";
import { QUADRANTS } from "../../vision/src/cv/quadrant.js";
import { DEGRADE_ACC, ESCAPE_POSITION, MAX_LABEL_CHARS, SLOT_ORDER, place, slotIndex } from "../src/layout.js";
import { SLOT_TABLE, needsConfirm, spanCount } from "../src/slots.js";
import { idleBoard, drillBoard, orientationAnswer, respondingBoard } from "../src/boards.js";
import type { SlotSpec } from "../src/layout.js";
import type { TurnType } from "../src/types.js";

const spec = (label: string, rank: number): SlotSpec => ({
  rank,
  role: "guess",
  label,
  act: "speak",
  source: "template",
});

const TYPES = Object.keys(SLOT_TABLE) as TurnType[];

describe("SLOT_ORDER vs the vision module", () => {
  // The bug this guards: vision reports corners CLOCKWISE, the app lays out boxes in READING order.
  // They agree on 0 and 1 and disagree on 2 and 3, so confusing them silently swaps the least-likely
  // reply with the escape and nothing throws.
  it("is a permutation of vision's QUADRANTS but NOT the same order", () => {
    expect([...SLOT_ORDER].sort()).toEqual([...QUADRANTS].sort());
    expect([...SLOT_ORDER]).not.toEqual([...QUADRANTS]);
  });

  it("maps every quadrant to a distinct index", () => {
    const idx = QUADRANTS.map(slotIndex);
    expect(new Set(idx).size).toBe(4);
    expect(idx.every((i) => i >= 0 && i < 4)).toBe(true);
  });

  it("puts the escape bottom-right", () => {
    expect(slotIndex(ESCAPE_POSITION)).toBe(3);
  });
});

describe("place()", () => {
  it("always returns four cells in reading order", () => {
    const { slots } = place("responding", [spec("a", 1), spec("b", 2), spec("c", 3)]);
    expect(slots).toHaveLength(4);
    expect(slots.map((s) => s?.position)).toEqual([...SLOT_ORDER]);
  });

  it("maps rank to position deterministically, never reordering", () => {
    const { slots } = place("responding", [spec("first", 1), spec("second", 2), spec("third", 3)]);
    expect(slots[0]?.label).toBe("first");
    expect(slots[1]?.label).toBe("second");
    expect(slots[2]?.label).toBe("third");
  });

  it("puts an escape on every responding board", () => {
    for (let n = 0; n <= 3; n++) {
      const { slots } = place("responding", Array.from({ length: n }, (_, i) => spec(`x${i}`, i + 1)));
      expect(slots[3]?.role).toBe("escape");
    }
  });

  it("puts NO escape on idle or drill boards, and gives them a fourth content box", () => {
    const content = [spec("a", 1), spec("b", 2), spec("c", 3), spec("d", 4)];
    for (const kind of ["idle", "drill"] as const) {
      const { slots, contentBoxes } = place(kind, content);
      expect(slots.some((s) => s?.role === "escape")).toBe(false);
      expect(contentBoxes).toBe(4);
      expect(slots[3]?.label).toBe("d");
    }
  });

  it("degrades down to two content boxes when the patient is tiring, keeping the escape", () => {
    const { slots, contentBoxes } = place("responding", [spec("a", 1), spec("b", 2), spec("c", 3)], {
      fatigue: "elevated",
    });
    expect(contentBoxes).toBe(2);
    expect(slots[2]).toBeNull();
    expect(slots[3]?.role).toBe("escape"); // never shrink to three by dropping the escape
  });

  it("degrades when the bottom-left target calibrated badly", () => {
    const weak = place("responding", [spec("a", 1), spec("b", 2), spec("c", 3)], {
      accuracy: { bottomLeft: DEGRADE_ACC - 0.01 },
    });
    expect(weak.contentBoxes).toBe(2);
    expect(weak.slots[2]).toBeNull();

    const ok = place("responding", [spec("a", 1), spec("b", 2), spec("c", 3)], {
      accuracy: { bottomLeft: DEGRADE_ACC + 0.01 },
    });
    expect(ok.contentBoxes).toBe(3);
  });

  it("ignores a NaN accuracy rather than degrading on it", () => {
    // fitQuadrants yields NaN when a target produced no finite vectors.
    const { contentBoxes } = place("responding", [spec("a", 1), spec("b", 2), spec("c", 3)], {
      accuracy: { bottomLeft: Number.NaN },
    });
    expect(contentBoxes).toBe(3);
  });

  it("refuses a label too wide to read from a bed", () => {
    expect(() => place("responding", [spec("x".repeat(MAX_LABEL_CHARS + 1), 1)])).toThrow(/too long/);
    // Measured in characters, not words: six short words fit, one long word may not.
    expect(() => place("responding", [spec("I want to ask or say", 1)])).not.toThrow();
  });

  it("refuses more content than the board has room for", () => {
    const four = [spec("a", 1), spec("b", 2), spec("c", 3), spec("d", 4)];
    expect(() => place("responding", four)).toThrow(/content boxes/);
  });
});

describe("the slot table", () => {
  it("gives every turn type exactly three ranked content boxes", () => {
    for (const t of TYPES) expect(SLOT_TABLE[t]).toHaveLength(3);
  });

  it("keeps every template label short enough to read", () => {
    for (const t of TYPES) {
      for (const s of SLOT_TABLE[t]) {
        expect(s.label.trim().length, `${t}/${s.role}: ${s.label}`).toBeLessThanOrEqual(MAX_LABEL_CHARS);
      }
    }
  });

  it("generates nothing at all for procedure and consent", () => {
    expect(spanCount("procedure")).toBe(0);
    expect(spanCount("consent")).toBe(0);
  });

  it("pre-accounts the refusal on a polar question, so saying no costs no extra selections", () => {
    const refuse = SLOT_TABLE.polar.find((s) => s.role === "refuse");
    expect(refuse?.label).toBe("No, not right now");
    expect(refuse?.generated).toBeFalsy(); // a model must never soften or drop the refusal
  });

  it("puts Wait on the most reliable target for a procedure announcement", () => {
    expect(SLOT_TABLE.procedure[0]?.role).toBe("halt");
    expect(SLOT_TABLE.procedure[0]?.label).toBe("Wait");
  });

  it("splits yes and no across the strong horizontal axis on consent, and asks to confirm", () => {
    const { slots } = place("responding", SLOT_TABLE.consent.map((s, i) => ({ ...s, rank: i + 1, act: "speak" as const })));
    expect(slots[0]?.role).toBe("affirm");
    expect(slots[1]?.role).toBe("refuse");
    expect(slots[0]?.position).toBe("topLeft");
    expect(slots[1]?.position).toBe("topRight");
    expect(needsConfirm("consent")).toBe(true);
  });

  it("never lets a model write a consent box", () => {
    expect(SLOT_TABLE.consent.every((s) => !s.generated)).toBe(true);
  });
});

describe("boards", () => {
  it("builds every turn type with no model at all", () => {
    for (const t of TYPES) {
      const b = respondingBoard({ turnId: "t1", turnType: t, transcript: "..." });
      expect(b.slots).toHaveLength(4);
      expect(b.slots[3]?.role).toBe("escape");
      expect(b.slots.slice(0, 3).every((s) => s && s.label.length > 0)).toBe(true);
      expect(b.source).toBe("template");
    }
  });

  it("fills generated slots in order and marks where the text came from", () => {
    const b = respondingBoard({ turnId: "t1", turnType: "polar", transcript: "are you in pain", spans: ["its my back"] });
    expect(b.slots[0]?.label).toBe("Yes");
    expect(b.slots[0]?.source).toBe("template");
    expect(b.slots[2]?.label).toBe("its my back");
    expect(b.slots[2]?.source).toBe("model");
  });

  it("falls back to the template when a span is blank", () => {
    const b = respondingBoard({ turnId: "t1", turnType: "polar", transcript: "x", spans: ["   "] });
    expect(b.slots[2]?.label).toBe("Sort of");
    expect(b.slots[2]?.source).toBe("template");
  });

  it("reaches all four of Light's purposes within two selections from idle", () => {
    const idle = idleBoard();
    expect(idle.slots.every((s) => s !== null)).toBe(true); // four content boxes, no escape
    const labels = idle.slots.map((s) => s?.label);
    expect(labels).toContain("I can't breathe");
    expect(labels).toContain("I'm in pain");

    const say = drillBoard("say", new Date(), {})!;
    const sayLabels = say.slots.map((s) => s?.label);
    expect(sayLabels).toContain("I'm scared");               // social closeness
    expect(sayLabels).toContain("Tell them I love them");    // social closeness
    expect(sayLabels).toContain("What time is it?");         // orientation
  });

  it("answers orientation with no nurse and no model", () => {
    const say = drillBoard("say", new Date("2026-10-24T14:10:00"), { where: "St. Luke's, bed 4" })!;
    const slot = say.slots.find((s) => s?.label === "What time is it?");
    expect(slot?.act).toBe("announce");
    expect(slot?.say).toMatch(/Saturday afternoon/);
    expect(slot?.say).toMatch(/St\. Luke's, bed 4\./);
  });

  it("offers a way out of the escape board rather than dead-ending", () => {
    const esc = drillBoard("escape", new Date(), {})!;
    expect(esc.slots.some((s) => s?.act === "spell")).toBe(true);
  });

  it("returns null for an unknown drill board instead of an empty one", () => {
    expect(drillBoard("nope", new Date(), {})).toBeNull();
  });

  it("keeps every hand-authored board within the readable width", () => {
    // place() throws on an over-wide label, so building each board is the assertion. This is what
    // caught "I want to ask or say" when the cap was still counting words.
    const ids = ["say", "say-more", "needs", "needs-more", "escape"];
    expect(() => {
      idleBoard();
      for (const id of ids) drillBoard(id, new Date(), {});
    }).not.toThrow();
  });

  it("gives every drill board a way back to idle", () => {
    for (const id of ["say", "say-more", "needs", "needs-more", "escape"]) {
      expect(drillBoard(id, new Date(), {})!.backTo, id).toBe("idle");
    }
  });
});

describe("orientationAnswer", () => {
  it("leads with the day and time, which is what is actually being asked", () => {
    expect(orientationAnswer(new Date("2026-10-24T09:05:00"))).toBe("It's Saturday morning, 9:05.");
  });

  it("appends only the clauses it has", () => {
    const t = orientationAnswer(new Date("2026-10-24T20:00:00"), { where: "bed 4", next: "tube out tomorrow" });
    expect(t).toBe("It's Saturday evening, 20:00. bed 4. tube out tomorrow.");
  });
});
