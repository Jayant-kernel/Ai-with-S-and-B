import { describe, expect, it, vi } from "vitest";

import { chatWithOpenAICompatible } from "../../lib/ai/openai-compatible";

describe("OpenAI-compatible model client", () => {
  it("supports Groq without exposing the key in the request body", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.groq.com/openai/v1/chat/completions");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer groq-secret");
      expect(String(init?.body)).not.toContain("groq-secret");
      return Response.json({
        choices: [{ message: { content: "Namaste ji" }, finish_reason: "stop" }],
      });
    }) as unknown as typeof fetch;

    await expect(chatWithOpenAICompatible({
      provider: "groq",
      apiKey: "groq-secret",
      baseUrl: "https://api.groq.com/openai/v1/",
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: "Namaste" }],
      timeoutMs: 5_000,
      fetchImpl,
    })).resolves.toEqual({ content: "Namaste ji", finishReason: "stop" });
  });
});
