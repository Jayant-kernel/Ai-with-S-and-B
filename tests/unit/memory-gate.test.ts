import { describe, expect, it } from "vitest";

import { gateMemory } from "../../lib/memory/gate";

describe("post-turn memory gate", () => {
  it("stores only confirmed, useful, non-sensitive facts", () => {
    expect(gateMemory({
      text: "I enjoy old Hindi songs",
      category: "preference",
      confidence: 0.96,
      userConfirmed: true,
    })).toMatchObject({ disposition: "store" });

    expect(gateMemory({
      text: "I might visit Pune next month",
      category: "future_event",
      confidence: 0.7,
      userConfirmed: false,
    })).toMatchObject({ disposition: "pending" });

    expect(gateMemory({
      text: "My OTP is 123456",
      category: "unknown",
      confidence: 1,
      userConfirmed: true,
    })).toMatchObject({ disposition: "discard" });
  });
});
