import { describe, expect, it } from "vitest";

import {
  ConversationStateError,
  createConversationState,
  readConversationState,
} from "../../lib/sarvam/conversation-state";
import { EMPTY_DIALOGUE_META } from "../../lib/sarvam/settings";

describe("Sarvam conversation state", () => {
  const messages = [
    { role: "user" as const, content: "Namaste" },
    { role: "assistant" as const, content: "Namaste ji" },
  ];

  it("round-trips an encrypted, short-lived conversation", () => {
    const token = createConversationState(messages, "server-secret", 1_000);

    expect(readConversationState(token, "server-secret", 2_000)).toEqual({
      messages,
      meta: EMPTY_DIALOGUE_META,
    });
    expect(token.startsWith("v2.")).toBe(true);
    expect(token).not.toContain("Namaste");
    expect(Buffer.from(token.split(".")[2]!, "base64url").toString("utf8")).not.toContain("Namaste");
  });

  it("rejects tampering, the wrong secret, and expiry", () => {
    const token = createConversationState(messages, "server-secret", 1_000);

    expect(() => readConversationState(`${token}x`, "server-secret", 2_000)).toThrow();
    expect(() => readConversationState(token, "other-secret", 2_000)).toThrow();
    try {
      readConversationState(token, "server-secret", 31 * 60_000);
      throw new Error("Expected state expiry");
    } catch (error) {
      expect(error).toBeInstanceOf(ConversationStateError);
      expect(error).toMatchObject({ kind: "expired" });
    }
  });

  it("refuses to sign a state that it could not read back", () => {
    const tooManyMessages = Array.from({ length: 21 }, (_, index) => ({
      role: "user" as const,
      content: `turn ${index}`,
    }));

    expect(() => createConversationState(tooManyMessages, "server-secret")).toThrow();
  });

  it("prunes oldest turns when multilingual UTF-8 state would exceed the transport cap", () => {
    const largeMessages = Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      content: "नमस्ते ".repeat(180),
    }));
    const token = createConversationState(largeMessages, "server-secret");
    const restored = readConversationState(token, "server-secret");

    expect(token.length).toBeLessThanOrEqual(24_000);
    expect(restored.messages.length).toBeLessThan(largeMessages.length);
    expect(restored.messages.length % 2).toBe(0);
  });
});
