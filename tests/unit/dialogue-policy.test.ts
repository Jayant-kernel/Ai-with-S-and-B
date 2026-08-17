import { describe, expect, it } from "vitest";

import { fuseEnergy, planDialogue, vocalRegister } from "../../lib/companion/dialogue-policy";
import type { ProsodySignal } from "../../lib/companion/prosody";
import { classifySafety } from "../../lib/companion/safety";
import { EMPTY_DIALOGUE_META } from "../../lib/sarvam/settings";

function prosody(overrides: Partial<ProsodySignal>): ProsodySignal {
  return {
    silenceFraction: 0.4,
    speechMs: 3_000,
    spokenMs: 5_000,
    totalMs: 5_000,
    longestPauseMs: 500,
    pauseCount: 1,
    arousal: "settled",
    ...overrides,
  };
}

describe("dialogue policy", () => {
  it("prioritizes emotional exploration over immediate advice", () => {
    const transcript = "Everyone is busy and I feel lonely";
    const plan = planDialogue({
      transcript,
      history: [],
      meta: EMPTY_DIALOGUE_META,
      safety: classifySafety(transcript),
      now: new Date("2026-08-15T04:00:00Z"),
    });

    expect(plan.objective).toBe("EXPLORE_EMOTION");
    expect(plan.directive).toContain("Acknowledge the emotion before logistics");
    expect(plan.partOfDay).toBe("morning");
  });

  it("does not force another question after two question turns", () => {
    const plan = planDialogue({
      transcript: "I watched my serial today",
      history: [
        { role: "assistant", content: "Which serial was it?" },
        { role: "user", content: "The old family one" },
        { role: "assistant", content: "Did you enjoy it?" },
      ],
      meta: { ...EMPTY_DIALOGUE_META, turnCount: 3 },
      safety: classifySafety("I watched my serial today"),
    });

    expect(plan.mayAskQuestion).toBe(false);
    expect(plan.directive).toContain("Do not ask a question");
  });

  it("allows one safety question even after recent questions", () => {
    const transcript = "I fell and I cannot get up";
    const plan = planDialogue({
      transcript,
      history: [
        { role: "assistant", content: "Are you comfortable?" },
        { role: "assistant", content: "Is anyone nearby?" },
      ],
      meta: EMPTY_DIALOGUE_META,
      safety: classifySafety(transcript),
    });

    expect(plan.objective).toBe("SAFETY_CHECK");
    expect(plan.mayAskQuestion).toBe(true);
  });

  it("keeps the immediate follow-up in safety mode", () => {
    const plan = planDialogue({
      transcript: "haan",
      history: [{ role: "assistant", content: "Can you reach someone nearby?" }],
      meta: {
        ...EMPTY_DIALOGUE_META,
        lastObjective: "SAFETY_CHECK",
        lastRiskLevel: "urgent",
        lastSafetyConcern: "fall",
      },
      safety: classifySafety("haan"),
    });

    expect(plan.objective).toBe("SAFETY_CHECK");
    expect(plan.mayAskQuestion).toBe(true);
  });
});

describe("conversational energy matching", () => {
  const plan = (transcript: string) =>
    planDialogue({
      transcript,
      history: [],
      meta: EMPTY_DIALOGUE_META,
      safety: classifySafety(transcript),
      now: new Date("2026-08-17T06:00:00Z"),
    });

  it("caps a one-word turn to a single sentence and no question", () => {
    // The core "nice but not natural" failure: answering "हाँ" with a polished
    // paragraph plus a follow-up question. Enforced here, not just requested
    // in the prompt, because the model does not reliably obey the prompt.
    for (const minimal of ["हाँ", "अच्छा", "ठीक है", "हूँ"]) {
      const result = plan(minimal);
      expect(result.energy).toBe("minimal");
      expect(result.maxSentences).toBe(1);
      expect(result.mayAskQuestion).toBe(false);
    }
  });

  it("keeps a short ordinary turn short", () => {
    const result = plan("आज मैंने पौधों को पानी दिया");
    expect(result.energy).toBe("brief");
    expect(result.maxSentences).toBe(2);
  });

  it("gives room only when the person actually opens up", () => {
    const result = plan(
      "आज सुबह मैं बगीचे में गया था और वहाँ बहुत देर तक बैठा रहा, पुराने दिन याद आ रहे थे "
      + "जब बच्चे छोटे थे और सब लोग साथ रहते थे, अब सब अपने अपने कामों में व्यस्त हैं",
    );
    expect(result.energy).toBe("engaged");
    expect(result.maxSentences).toBe(4);
  });

  it("still allows a safety question even when the turn is minimal", () => {
    // "I can't breathe" is short, but must never be capped to a bare
    // acknowledgement or denied its one safety question.
    const result = plan("साँस नहीं आ रही");
    expect(result.objective).toBe("SAFETY_CHECK");
    expect(result.mayAskQuestion).toBe(true);
    expect(result.maxSentences).toBe(3);
  });

  it("tells the model not to praise ordinary daily activities", () => {
    expect(plan("पौधों को पानी दिया").directive).toContain("not an achievement");
  });
});

describe("vocalRegister", () => {
  it("defaults to even when no prosody signal was supplied", () => {
    expect(vocalRegister(undefined, "unknown")).toBe("even");
  });

  it("reads low arousal or slow tempo as heavy", () => {
    expect(vocalRegister(prosody({ arousal: "low" }), "steady")).toBe("heavy");
    expect(vocalRegister(prosody({ arousal: "settled" }), "slow")).toBe("heavy");
  });

  it("requires both high arousal and quick tempo to read as lively", () => {
    expect(vocalRegister(prosody({ arousal: "high" }), "quick")).toBe("lively");
    expect(vocalRegister(prosody({ arousal: "high" }), "steady")).toBe("even");
  });
});

describe("fuseEnergy", () => {
  it("only ever softens a brief turn, never upgrades one", () => {
    expect(fuseEnergy("brief", "low")).toBe("minimal");
    expect(fuseEnergy("brief", "settled")).toBe("brief");
    expect(fuseEnergy("brief", "high")).toBe("brief");
    expect(fuseEnergy("brief", undefined)).toBe("brief");
  });

  it("leaves a minimal or engaged turn exactly as the words already sized it", () => {
    expect(fuseEnergy("minimal", "low")).toBe("minimal");
    expect(fuseEnergy("engaged", "low")).toBe("engaged");
  });

  it("does not shorten a reply for slow tempo alone -- only for low arousal", () => {
    // A merely unhurried but fluent speaker keeps their full-size reply; the
    // silence-fraction result is the one with published effect size behind it.
    expect(fuseEnergy("brief", "settled")).toBe("brief");
  });
});

describe("prosody-aware planning", () => {
  it("folds a slow, pause-heavy turn down to a gentler reply than the words alone would give", () => {
    // "आज सुबह... ऊपर व्यस्त हैं" is the exact transcript the plain-text
    // suite scores as brief/2-sentence; heard slowly with heavy pauses it
    // should size down to minimal, not stay at "brief".
    const transcript = "आज मौसम अच्छा है";
    const withoutProsody = planDialogue({
      transcript,
      history: [],
      meta: EMPTY_DIALOGUE_META,
      safety: classifySafety(transcript),
      now: new Date("2026-08-17T06:00:00Z"),
    });
    const withHeavyProsody = planDialogue({
      transcript,
      history: [],
      meta: EMPTY_DIALOGUE_META,
      safety: classifySafety(transcript),
      now: new Date("2026-08-17T06:00:00Z"),
      prosody: prosody({ arousal: "low", speechMs: 4_000, spokenMs: 9_000 }),
    });

    expect(withoutProsody.energy).toBe("brief");
    expect(withHeavyProsody.energy).toBe("minimal");
    expect(withHeavyProsody.maxSentences).toBe(1);
    expect(withHeavyProsody.register).toBe("heavy");
    expect(withHeavyProsody.directive).toContain("slow and effortful");
  });

  it("slows the reply pace for a heavy register and speeds it slightly for a lively one", () => {
    const transcript = "आज मौसम अच्छा है";
    const heavy = planDialogue({
      transcript,
      history: [],
      meta: EMPTY_DIALOGUE_META,
      safety: classifySafety(transcript),
      prosody: prosody({ arousal: "low" }),
    });
    const lively = planDialogue({
      transcript,
      history: [],
      meta: EMPTY_DIALOGUE_META,
      safety: classifySafety(transcript),
      // Short speechMs relative to the 4-word transcript so tempo reads as
      // "quick" (>165wpm) -- lively register requires both high arousal and
      // quick tempo, see vocalRegister.
      prosody: prosody({ arousal: "high", speechMs: 900, spokenMs: 1_000 }),
    });

    expect(heavy.paceScale).toBeLessThan(1);
    expect(lively.paceScale).toBeGreaterThan(1);
  });

  it("never lets vocal register soften a safety turn", () => {
    const transcript = "साँस नहीं आ रही";
    const plan = planDialogue({
      transcript,
      history: [],
      meta: EMPTY_DIALOGUE_META,
      safety: classifySafety(transcript),
      prosody: prosody({ arousal: "low", speechMs: 4_000, spokenMs: 9_000 }),
    });

    expect(plan.objective).toBe("SAFETY_CHECK");
    expect(plan.mayAskQuestion).toBe(true);
    expect(plan.maxSentences).toBe(3);
    expect(plan.directive).not.toContain("slow and effortful");
  });

  it("never lets vocal register soften a repair turn", () => {
    const transcript = "नहीं, मैंने कहा था कि बेटा आएगा";
    const plan = planDialogue({
      transcript,
      history: [],
      meta: EMPTY_DIALOGUE_META,
      safety: classifySafety(transcript),
      prosody: prosody({ arousal: "low", speechMs: 5_000, spokenMs: 11_000 }),
    });

    expect(plan.objective).toBe("REPAIR");
    expect(plan.directive).not.toContain("slow and effortful");
  });

  it("leaves a long, engaged turn at full length even when it came out slowly", () => {
    const transcript =
      "आज सुबह मैं बगीचे में गया था और वहाँ बहुत देर तक बैठा रहा, पुराने दिन याद आ रहे थे "
      + "जब बच्चे छोटे थे और सब लोग साथ रहते थे, अब सब अपने अपने कामों में व्यस्त हैं";
    const plan = planDialogue({
      transcript,
      history: [],
      meta: EMPTY_DIALOGUE_META,
      safety: classifySafety(transcript),
      prosody: prosody({ arousal: "low", speechMs: 20_000, spokenMs: 32_000 }),
    });

    expect(plan.energy).toBe("engaged");
    expect(plan.maxSentences).toBe(4);
  });
});
