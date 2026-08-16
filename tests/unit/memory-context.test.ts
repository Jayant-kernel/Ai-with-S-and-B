import { describe, expect, it } from "vitest";

import { mayWriteMemory, selectMemoryContext } from "../../lib/memory/context";

const now = new Date("2026-08-16T00:00:00Z");

describe("memory context budget", () => {
  it("hard-fences reads and writes in private mode", () => {
    const memory = {
      id: "1",
      kind: "profile" as const,
      status: "approved" as const,
      text: "Likes old Hindi songs",
      confidence: 0.99,
      userConfirmed: true,
      updatedAt: now,
    };

    expect(selectMemoryContext({ memories: [memory], privateMode: true, now })).toEqual([]);
    expect(mayWriteMemory(true)).toBe(false);
  });

  it("loads only approved, confirmed and unexpired memories", () => {
    const memories = [
      {
        id: "profile",
        kind: "profile" as const,
        status: "approved" as const,
        text: "Likes old Hindi songs",
        confidence: 0.99,
        userConfirmed: true,
        updatedAt: now,
      },
      {
        id: "pending",
        kind: "thread" as const,
        status: "pending" as const,
        text: "May travel next month",
        confidence: 0.9,
        userConfirmed: false,
        updatedAt: now,
      },
      {
        id: "expired",
        kind: "thread" as const,
        status: "approved" as const,
        text: "Doctor appointment yesterday",
        confidence: 0.99,
        userConfirmed: true,
        updatedAt: now,
        expiresAt: new Date("2026-08-15T00:00:00Z"),
      },
    ];

    expect(selectMemoryContext({ memories, privateMode: false, now })).toEqual([
      { kind: "profile", text: "Likes old Hindi songs" },
    ]);
  });
});
