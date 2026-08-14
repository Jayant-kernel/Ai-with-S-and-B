import { describe, expect, it } from "vitest";

import { planDialogue } from "../../lib/companion/dialogue-policy";
import { classifySafety } from "../../lib/companion/safety";
import { EMPTY_DIALOGUE_META } from "../../lib/sarvam/settings";

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
