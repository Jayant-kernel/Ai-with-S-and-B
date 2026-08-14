import { describe, expect, it } from "vitest";

import { boundedHistory } from "../../lib/sarvam/turn";

describe("Sarvam conversation history", () => {
  it("keeps only recent, non-empty, length-bounded messages", () => {
    const history = [
      { role: "user" as const, content: "old" },
      { role: "assistant" as const, content: "  " },
      { role: "user" as const, content: "x".repeat(2_000) },
      { role: "assistant" as const, content: "latest" },
    ];

    const result = boundedHistory(history, 3);

    expect(result).toHaveLength(2);
    expect(result[0]?.content).toHaveLength(1_500);
    expect(result[1]).toEqual({ role: "assistant", content: "latest" });
  });
});
