import { describe, expect, it } from "vitest";

import type { StoredMemory } from "../../lib/memory/context";
import { boundedHistory, memoryContextMessage } from "../../lib/sarvam/turn";

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

describe("Sarvam memory context injection", () => {
  const approvedMemory: StoredMemory = {
    id: "item-1",
    kind: "profile",
    status: "approved",
    text: "Enjoys listening to old Kishore Kumar songs",
    confidence: 0.95,
    userConfirmed: true,
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
  };

  it("returns null (no extra system message) when there are no stored memories", () => {
    expect(memoryContextMessage([])).toBeNull();
  });

  // Persisting memory alone never feeds it back into a future reply --
  // this is the function that actually closes the loop.
  it("builds one system message listing approved, confirmed memories", () => {
    const message = memoryContextMessage([approvedMemory]);
    expect(message?.role).toBe("system");
    expect(message?.content).toContain("Enjoys listening to old Kishore Kumar songs");
  });

  it("excludes memories that are not yet confirmed, reusing selectMemoryContext's own rules", () => {
    const pendingMemory: StoredMemory = { ...approvedMemory, status: "pending", userConfirmed: false };
    expect(memoryContextMessage([pendingMemory])).toBeNull();
  });
});
