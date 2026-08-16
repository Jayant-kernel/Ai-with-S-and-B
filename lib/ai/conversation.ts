import "server-only";

import type { ServerEnv } from "@/lib/config/env-schema";
import {
  chatWithOpenAICompatible,
  type ModelMessage,
} from "@/lib/ai/openai-compatible";
import { chatWithSarvam } from "@/lib/sarvam/client";

export async function generateConversationReply(input: {
  messages: ModelMessage[];
  env: ServerEnv;
}) {
  const provider = input.env.CONVERSATION_PROVIDER === "auto"
    ? input.env.GROQ_API_KEY
      ? "groq"
      : input.env.SARVAM_API_KEY
        ? "sarvam"
        : "openai"
    : input.env.CONVERSATION_PROVIDER;

  if (provider === "sarvam") {
    if (!input.env.SARVAM_API_KEY) throw new Error("Sarvam conversation model is not configured.");
    return chatWithSarvam(
      { model: input.env.SARVAM_CHAT_MODEL, messages: input.messages },
      {
        apiKey: input.env.SARVAM_API_KEY,
        timeoutMs: input.env.MODEL_REQUEST_TIMEOUT_MS,
      },
    );
  }

  const isGroq = provider === "groq";
  const apiKey = isGroq ? input.env.GROQ_API_KEY : input.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(`${provider} conversation model is not configured.`);
  }

  return chatWithOpenAICompatible({
    provider: isGroq ? "groq" : "openai",
    apiKey,
    baseUrl: isGroq ? input.env.GROQ_BASE_URL : input.env.OPENAI_BASE_URL,
    model: isGroq
      ? input.env.GROQ_CONVERSATION_MODEL
      : input.env.OPENAI_CONVERSATION_MODEL,
    messages: input.messages,
    timeoutMs: input.env.MODEL_REQUEST_TIMEOUT_MS,
  });
}
