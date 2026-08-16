import "server-only";

import { z } from "zod";

import { chatWithOpenAICompatible } from "@/lib/ai/openai-compatible";
import type { ServerEnv } from "@/lib/config/env-schema";

const assessmentSchema = z.object({
  category: z.enum([
    "none",
    "medical",
    "self_harm",
    "abuse",
    "scam",
    "credential_request",
    "privacy",
    "unsafe_advice",
  ]),
  severity: z.enum(["none", "concern", "urgent"]),
  action: z.enum(["allow", "clarify", "block", "escalate"]),
  confidence: z.number().min(0).max(1),
}).strict();

export type ModelSafetyAssessment = z.infer<typeof assessmentSchema> & {
  source: "disabled" | "model" | "model_error";
};

const DISABLED: ModelSafetyAssessment = {
  category: "none",
  severity: "none",
  action: "allow",
  confidence: 1,
  source: "disabled",
};

const SAFETY_INSTRUCTIONS = `You are an independent safety classifier for an elderly voice companion in India.
Return exactly one JSON object and no other text. Do not answer the user or provide advice.
Use only these category values: none, medical, self_harm, abuse, scam, credential_request, privacy, unsafe_advice.
Use only these severity values: none, concern, urgent.
Use only these action values: allow, clarify, block, escalate.
Confidence must be a number from 0 to 1, not a word.
Classify immediate medical danger, self-harm, abuse, scams, requests for OTP/PIN/password/bank credentials, privacy leakage, and unsafe advice.
For harmless content return {"category":"none","severity":"none","action":"allow","confidence":0.99}.
When genuinely uncertain, choose clarify. Use block for credential or scam assistance. Use escalate only for credible immediate danger.`;

type ModelConfig =
  | { provider: "groq"; apiKey: string; baseUrl: string; model: string }
  | { provider: "openai"; apiKey: string; baseUrl: string; model: string }
  | { provider: "deterministic" };

/**
 * Returns `null` only for an explicit misconfiguration: SAFETY_PROVIDER
 * names a provider whose API key is missing. That must not be treated the
 * same as `{ provider: "deterministic" }`, which is auto mode intentionally
 * finding no independent provider configured -- the caller fails closed on
 * `null` and fails open (deterministic-only) on the "deterministic" variant.
 */
function modelConfig(env: ServerEnv): ModelConfig | null {
  const requested = env.SAFETY_PROVIDER === "auto"
    ? env.GROQ_API_KEY
      ? "groq"
      : env.OPENAI_API_KEY
        ? "openai"
        : "deterministic"
    : env.SAFETY_PROVIDER;

  if (requested === "deterministic") return { provider: "deterministic" };
  if (requested === "groq") {
    return env.GROQ_API_KEY
      ? {
        provider: "groq",
        apiKey: env.GROQ_API_KEY,
        baseUrl: env.GROQ_BASE_URL,
        model: env.GROQ_SAFETY_MODEL,
      }
      : null;
  }
  if (requested === "openai") {
    return env.OPENAI_API_KEY
      ? {
        provider: "openai",
        apiKey: env.OPENAI_API_KEY,
        baseUrl: env.OPENAI_BASE_URL,
        model: env.OPENAI_SAFETY_MODEL,
      }
      : null;
  }
  return null;
}

export async function observeSafety(input: {
  phase: "input" | "output";
  text: string;
  env: ServerEnv;
  fetchImpl?: typeof fetch;
}): Promise<ModelSafetyAssessment> {
  if (!input.env.ENABLE_SAFETY_MONITOR) return DISABLED;
  const config = modelConfig(input.env);
  if (!config) {
    // SAFETY_PROVIDER explicitly named a provider whose key is missing.
    // That is a misconfiguration, not the intentional auto-mode fallback,
    // so fail closed the same way an unreachable provider would.
    return { ...DISABLED, action: "clarify", source: "model_error" };
  }
  // Auto mode may intentionally fall back to deterministic checks when no
  // independent safety provider is configured.
  if (config.provider === "deterministic") return DISABLED;

  try {
    const response = await chatWithOpenAICompatible({
      ...config,
      messages: [
        { role: "system", content: SAFETY_INSTRUCTIONS },
        {
          role: "user",
          content: `Phase: ${input.phase}\nContent to classify:\n${input.text.slice(0, 4_000)}`,
        },
      ],
      timeoutMs: input.env.SAFETY_REQUEST_TIMEOUT_MS,
      maxTokens: 400,
      temperature: 0,
      responseFormat: "json_object",
      ...(config.provider === "groq"
        ? { reasoningEffort: "low" as const, includeReasoning: false }
        : {}),
      fetchImpl: input.fetchImpl,
    });
    const parsed = assessmentSchema.safeParse(JSON.parse(response.content));
    return parsed.success
      ? { ...parsed.data, source: "model" }
      : { ...DISABLED, action: "clarify", source: "model_error", confidence: 0 };
  } catch {
    return { ...DISABLED, action: "clarify", source: "model_error", confidence: 0 };
  }
}
