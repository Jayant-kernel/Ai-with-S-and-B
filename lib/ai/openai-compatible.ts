import "server-only";

import { z } from "zod";

export type ModelMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const completionSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string().nullable() }),
    finish_reason: z.string().nullable().optional(),
  })).min(1),
});

export class TextModelError extends Error {
  constructor(
    readonly provider: "groq" | "openai",
    readonly status: number,
    message = `${provider} text model request failed.`,
  ) {
    super(message);
    this.name = "TextModelError";
  }
}

export async function chatWithOpenAICompatible(input: {
  provider: "groq" | "openai";
  apiKey: string;
  baseUrl: string;
  model: string;
  messages: ModelMessage[];
  timeoutMs: number;
  maxTokens?: number;
  temperature?: number;
  responseFormat?: "json_object";
  reasoningEffort?: "low" | "medium" | "high";
  includeReasoning?: boolean;
  fetchImpl?: typeof fetch;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    const response = await (input.fetchImpl ?? fetch)(
      `${input.baseUrl.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: input.model,
          messages: input.messages,
          max_tokens: input.maxTokens ?? 220,
          temperature: input.temperature ?? 0.4,
          ...(input.responseFormat
            ? { response_format: { type: input.responseFormat } }
            : {}),
          ...(input.reasoningEffort
            ? { reasoning_effort: input.reasoningEffort }
            : {}),
          ...(input.includeReasoning !== undefined
            ? { include_reasoning: input.includeReasoning }
            : {}),
        }),
        cache: "no-store",
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new TextModelError(input.provider, response.status);
    }

    const parsed = completionSchema.safeParse(await response.json());
    const content = parsed.success
      ? parsed.data.choices[0]?.message.content?.trim()
      : "";
    if (!content) throw new TextModelError(input.provider, 502, "Text model returned no reply.");

    return {
      content,
      finishReason: parsed.success
        ? parsed.data.choices[0]?.finish_reason ?? null
        : null,
    };
  } catch (error) {
    if (error instanceof TextModelError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new TextModelError(input.provider, 504, "Text model request timed out.");
    }
    throw new TextModelError(input.provider, 502);
  } finally {
    clearTimeout(timeout);
  }
}
