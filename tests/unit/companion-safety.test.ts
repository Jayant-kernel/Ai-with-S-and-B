import { describe, expect, it } from "vitest";

import { classifySafety } from "../../lib/companion/safety";

describe("companion safety classifier", () => {
  it("separates ordinary discomfort from urgent danger", () => {
    expect(classifySafety("My knees hurt a bit today")).toMatchObject({
      level: "none",
      concern: "none",
    });
    expect(classifySafety("My knee hurt me when I got up")).toMatchObject({ level: "none" });
    expect(classifySafety("I can't stand this loneliness")).toMatchObject({ level: "none" });
    expect(classifySafety("I have severe chest pain")).toMatchObject({
      level: "urgent",
      concern: "chest_pain",
    });
    expect(classifySafety("मैं गिर गई और उठ नहीं पा रही")).toMatchObject({
      level: "urgent",
      concern: "fall",
    });
  });

  it("detects medication uncertainty without inventing an answer", () => {
    expect(classifySafety("Which medicine did I already take?")).toMatchObject({
      level: "concern",
      concern: "medication_uncertainty",
    });
    expect(classifySafety("कौन सी दवा मैंने ले ली थी?")).toMatchObject({
      level: "concern",
      concern: "medication_uncertainty",
    });
    expect(classifySafety("I don't remember if I took my medicine")).toMatchObject({
      concern: "medication_uncertainty",
    });
    expect(classifySafety("I took my dose this morning")).toMatchObject({
      level: "none",
      concern: "none",
    });
  });
});
