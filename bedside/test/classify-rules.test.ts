import { describe, expect, it } from "vitest";
import { classifyByRules } from "../src/classify-rules.js";
import type { TurnType } from "../src/types.js";

const t = (s: string) => classifyByRules(s).type;

describe("classifyByRules", () => {
  it("routes consent questions away from any model", () => {
    for (const s of [
      "Do you agree to the blood transfusion?",
      "We need to give you a sedative, okay?",
      "Do you want to be resuscitated if your heart stops?",
      "The doctor is going to do a procedure on your arm, is that okay?",
    ]) {
      expect(t(s), s).toBe("consent");
    }
  });

  it("catches procedure announcements, including ones wearing a question mark", () => {
    // These must not come back as polar: the patient needs "Wait" far more than yes/no.
    for (const s of [
      "I'm going to suction you now",
      "I'm just going to turn you on your side",
      "We're about to move you up the bed",
      "I need to change your dressing",
      "Let me check your line",
      "I'm going to sit you up, okay?",
    ]) {
      expect(t(s), s).toBe("procedure");
    }
  });

  it("reads wh-questions", () => {
    for (const s of ["How are you feeling today?", "Where does it hurt?", "What do you need?"]) {
      expect(t(s), s).toBe("wh");
    }
  });

  it("reads a choice between named options", () => {
    for (const s of ["Do you want tea or water?", "Should I call your daughter or your son?"]) {
      expect(t(s), s).toBe("alternative");
    }
  });

  it("reads polar questions", () => {
    for (const s of [
      "Are you thirsty?",
      "Are you in any pain right now?",
      "Do you need to be suctioned?",
      "Can you hear me okay?",
      "Did you sleep okay last night?",
    ]) {
      expect(t(s), s).toBe("polar");
    }
  });

  it("treats a statement as informing, not as a question to answer", () => {
    // The current server fabricates an *answer* to these. The right reply is a news receipt.
    for (const s of ["Your daughter is coming at six", "The doctor already came by this morning"]) {
      expect(t(s), s).toBe("informing");
    }
  });

  it("abstains on declaratives so the model gets a say, but is confident on the rest", () => {
    expect(classifyByRules("Your daughter is coming at six").confident).toBe(false);
    for (const s of ["Are you thirsty?", "I'm going to suction you", "How are you feeling?"]) {
      expect(classifyByRules(s).confident, s).toBe(true);
    }
  });

  it("falls back to polar for an unrecognised question rather than guessing", () => {
    const r = classifyByRules("Comfortable?");
    expect(r.type).toBe("polar");
    expect(r.confident).toBe(true);
  });

  it("gives a reason for every verdict, so a bad call is debuggable from the log", () => {
    for (const s of ["Are you thirsty?", "Your daughter is coming", "I'm going to turn you"]) {
      expect(classifyByRules(s).why.length).toBeGreaterThan(0);
    }
  });
});

describe("the whole eval set classifies without throwing", () => {
  // The 28 phrases from conversation/scripts/eval-phrases.ts, with the type each should get.
  const CASES: [string, TurnType][] = [
    ["Are you thirsty?", "polar"],
    ["Are you in any pain right now?", "polar"],
    ["Where does it hurt?", "wh"],
    ["Do you need to be suctioned?", "polar"],
    ["Are you cold?", "polar"],
    ["Would you like me to raise the head of your bed?", "polar"],
    ["Do you want the lights off?", "polar"],
    ["Did you sleep okay last night?", "polar"],
    ["Do you know where you are?", "polar"],
    ["Are you feeling anxious?", "polar"],
    ["Is the tube bothering you?", "polar"],
    ["Do you need to use the bathroom?", "polar"],
    ["Do you want the TV on?", "polar"],
    ["Do you agree to the blood transfusion?", "consent"],
    ["We need to give you a sedative, okay?", "consent"],
    ["Do you want to be resuscitated if your heart stops?", "consent"],
    ["How are you feeling today?", "wh"],
    ["Can you hear me okay?", "polar"],
  ];

  it("gets each one right", () => {
    const wrong = CASES.filter(([phrase, want]) => t(phrase) !== want);
    expect(wrong.map(([p, want]) => `${p} -> ${t(p)}, wanted ${want}`)).toEqual([]);
  });
});
