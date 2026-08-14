import { describe, expect, it } from "vitest";

import { shapeSpokenResponse } from "../../lib/companion/spoken-response";

describe("spoken response shaping", () => {
  it("keeps speech short and allows at most one question", () => {
    const result = shapeSpokenResponse(
      "Hmm… that sounds difficult. Did you miss Amit? Would you like to call him? I can make a list.",
      { maxSentences: 3, maxQuestions: 1 },
    );

    expect(result.spoken).toBe("Hmm… that sounds difficult. Did you miss Amit? I can make a list.");
    expect(result.questionCount).toBe(1);
    expect(result.trimmed).toBe(true);
  });

  it("removes checklist formatting from spoken output", () => {
    expect(shapeSpokenResponse("- Hmm.\n- Take your time.").spoken).toBe("Hmm. Take your time.");
  });

  it("does not leak a question back through the empty-selection fallback", () => {
    const result = shapeSpokenResponse("Would you like to call someone?", { maxQuestions: 0 });

    expect(result.spoken).toBe("Hmm…");
    expect(result.questionCount).toBe(0);
  });

  it("counts adjacent questions separately", () => {
    const result = shapeSpokenResponse("Are you hurt?Should I call someone?", { maxQuestions: 1 });

    expect(result.spoken).toBe("Are you hurt?");
    expect(result.questionCount).toBe(1);
  });
});
