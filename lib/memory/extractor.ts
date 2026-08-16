import "server-only";

import { z } from "zod";

import { chatWithOpenAICompatible } from "@/lib/ai/openai-compatible";
import type { ServerEnv } from "@/lib/config/env-schema";
import type { MemoryCategory } from "@/lib/memory/gate";

const MEMORY_CATEGORIES = [
  "preference",
  "relationship",
  "future_event",
  "health",
  "financial",
  "secret",
  "unknown",
] as const satisfies readonly MemoryCategory[];

const candidateSchema = z.object({
  text: z.string().min(1).max(280),
  category: z.enum(MEMORY_CATEGORIES),
  confidence: z.number().min(0).max(1),
}).strict();

const responseSchema = z.object({
  candidates: z.array(candidateSchema).max(2),
}).strict();

export type ExtractedMemoryCandidate = z.infer<typeof candidateSchema>;

const EXTRACTION_INSTRUCTIONS = `You extract durable memory candidates from one turn of a voice conversation with an elderly companion in India.
Return exactly one JSON object and no other text, shaped as {"candidates": [...]}. The array holds 0 to 2 items.
Each item is {"text": string, "category": string, "confidence": number}.
"text" is a short, third-person durable fact worth remembering later (under 280 characters), for example "Enjoys listening to old Kishore Kumar songs" or "Grandson Arjun visited last Sunday".
"category" must be exactly one of: preference, relationship, future_event, health, financial, secret, unknown.
Use "financial" for money, bank, UPI, loan, or payment details. Use "secret" for anything the speaker asked to keep private, or credentials.
Always classify financial or secret content into its category instead of omitting it -- a downstream system decides whether to keep it, not you.
"confidence" is 0 to 1: how sure you are this is a durable, worth-remembering fact rather than small talk.
If nothing in this turn is worth remembering, return {"candidates": []}.
Never invent facts that were not said.`;

type ModelConfig =
  | { provider: "groq"; apiKey: string; baseUrl: string; model: string }
  | { provider: "openai"; apiKey: string; baseUrl: string; model: string }
  | null;

// Auto-selects the same way generateConversationReply does (Groq, then
// OpenAI), reusing the already-configured conversation models -- no new
// provider-selection env var for a feature this small. Sarvam's chat
// client is skipped: extraction needs JSON-mode structured output.
function modelConfig(env: ServerEnv): ModelConfig {
  if (env.GROQ_API_KEY) {
    return {
      provider: "groq",
      apiKey: env.GROQ_API_KEY,
      baseUrl: env.GROQ_BASE_URL,
      model: env.GROQ_CONVERSATION_MODEL,
    };
  }
  if (env.OPENAI_API_KEY) {
    return {
      provider: "openai",
      apiKey: env.OPENAI_API_KEY,
      baseUrl: env.OPENAI_BASE_URL,
      model: env.OPENAI_CONVERSATION_MODEL,
    };
  }
  return null;
}

/**
 * Best-effort candidate extraction: any provider/parse failure returns an
 * empty array rather than throwing. This is called from inside
 * next/server's after() in app/api/sarvam/turn/route.ts, strictly after
 * the spoken reply has already reached the elder -- a failure here must
 * never surface anywhere.
 */
export async function extractMemoryCandidates(input: {
  transcript: string;
  reply: string;
  env: ServerEnv;
  fetchImpl?: typeof fetch;
}): Promise<ExtractedMemoryCandidate[]> {
  const config = modelConfig(input.env);
  if (!config) return [];

  try {
    const response = await chatWithOpenAICompatible({
      ...config,
      messages: [
        { role: "system", content: EXTRACTION_INSTRUCTIONS },
        {
          role: "user",
          content:
            `Elder said: ${input.transcript.slice(0, 2_000)}\n` +
            `Companion replied: ${input.reply.slice(0, 1_000)}`,
        },
      ],
      timeoutMs: input.env.MODEL_REQUEST_TIMEOUT_MS,
      maxTokens: 400,
      temperature: 0,
      responseFormat: "json_object",
      ...(config.provider === "groq"
        ? { reasoningEffort: "low" as const, includeReasoning: false }
        : {}),
      fetchImpl: input.fetchImpl,
    });
    const parsed = responseSchema.safeParse(JSON.parse(response.content));
    return parsed.success ? parsed.data.candidates : [];
  } catch {
    return [];
  }
}
