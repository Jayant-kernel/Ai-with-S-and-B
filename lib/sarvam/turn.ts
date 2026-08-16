import "server-only";

import { generateConversationReply } from "@/lib/ai/conversation";
import type { ModelMessage } from "@/lib/ai/openai-compatible";
import { planDialogue, updateDialogueMeta } from "@/lib/companion/dialogue-policy";
import { decideResponsePolicy } from "@/lib/companion/policy-engine";
import { classifySafety } from "@/lib/companion/safety";
import { observeSafety, type ModelSafetyAssessment } from "@/lib/companion/safety-observer";
import { shapeSpokenResponse } from "@/lib/companion/spoken-response";
import type { ServerEnv } from "@/lib/config/env-schema";
import { redactPii } from "@/lib/privacy/pii";
import { COMPANION_INSTRUCTIONS } from "@/lib/realtime/settings";
import { settleWithFallback } from "@/lib/util/settle-with-fallback";
import {
  synthesizeWithSarvam,
  transcribeWithSarvam,
} from "@/lib/sarvam/client";
import {
  SARVAM_TTS_LANGUAGES,
  type ConversationContext,
  type ConversationMessage,
  type SarvamVoice,
} from "@/lib/sarvam/settings";

function ttsLanguage(detected: string | undefined, fallback: string) {
  return SARVAM_TTS_LANGUAGES.includes(
    detected as (typeof SARVAM_TTS_LANGUAGES)[number],
  )
    ? detected!
    : fallback;
}

export function boundedHistory(
  history: ConversationMessage[],
  maxMessages: number,
) {
  return history
    .slice(-maxMessages)
    .map(({ role, content }) => ({ role, content: content.trim().slice(0, 1_500) }))
    .filter(({ content }) => content.length > 0);
}

export async function runSarvamTurn(input: {
  audio: Blob;
  filename: string;
  context: ConversationContext;
  speaker?: SarvamVoice;
  env: ServerEnv;
}) {
  const clientOptions = {
    apiKey: input.env.SARVAM_API_KEY!,
    timeoutMs: input.env.SARVAM_REQUEST_TIMEOUT_MS,
  };
  const startedAt = performance.now();

  const sttStartedAt = performance.now();
  const transcription = await transcribeWithSarvam(
    {
      audio: input.audio,
      filename: input.filename,
      model: input.env.SARVAM_STT_MODEL,
      languageCode: input.env.SARVAM_STT_LANGUAGE,
    },
    clientOptions,
  );
  const sttMs = Math.round(performance.now() - sttStartedAt);

  const history = boundedHistory(input.context.messages, input.env.SARVAM_HISTORY_MESSAGES)
    .map((message) => ({ ...message, content: redactPii(message.content).redacted }));
  const safety = classifySafety(transcription.transcript);
  const safeTranscript = redactPii(transcription.transcript).redacted;
  const plan = planDialogue({
    transcript: safeTranscript,
    history,
    meta: input.context.meta,
    safety,
  });

  const messages: ModelMessage[] = [
    { role: "system", content: COMPANION_INSTRUCTIONS },
    { role: "system", content: plan.directive },
    ...history,
    { role: "user", content: safeTranscript },
  ];
  const chatStartedAt = performance.now();
  // Wrapped in settleWithFallback so this can never become an unhandled
  // rejection if generateConversationReply throws below before this promise
  // is awaited. observeSafety is contracted to never reject on its own, but
  // that contract living only in its implementation is exactly the kind of
  // thing a future edit can quietly break.
  const inputSafetyPromise = settleWithFallback(
    observeSafety({ phase: "input", text: safeTranscript, env: input.env }),
    {
      category: "none",
      severity: "concern",
      action: "clarify",
      confidence: 0,
      source: "model_error",
    } satisfies ModelSafetyAssessment,
  );
  const chat = await generateConversationReply({ messages, env: input.env });
  const inputSafety = await inputSafetyPromise;
  const chatMs = Math.round(performance.now() - chatStartedAt);

  const shaped = shapeSpokenResponse(chat.content, {
    maxSentences: plan.objective === "SAFETY_CHECK" ? 3 : 2,
    maxQuestions: plan.mayAskQuestion ? 1 : 0,
  });
  const safetyStartedAt = performance.now();
  const outputSafety = await observeSafety({
    phase: "output",
    text: shaped.spoken,
    env: input.env,
  });
  const outputLanguageCode = ttsLanguage(
    transcription.languageCode,
    input.context.meta.preferredLanguage || input.env.SARVAM_TTS_LANGUAGE,
  );
  const decision = decideResponsePolicy({
    deterministic: safety,
    inputSafety,
    outputSafety,
    candidateReply: shaped.spoken,
    languageCode: outputLanguageCode,
  });
  const reply = decision.reply;
  const safetyMs = Math.round(performance.now() - safetyStartedAt);

  const ttsStartedAt = performance.now();
  const audioBase64 = await synthesizeWithSarvam(
    {
      text: reply,
      model: input.env.SARVAM_TTS_MODEL,
      languageCode: outputLanguageCode,
      speaker: input.speaker ?? input.env.SARVAM_TTS_SPEAKER,
      pace: input.env.SARVAM_TTS_PACE,
    },
    clientOptions,
  );
  const ttsMs = Math.round(performance.now() - ttsStartedAt);

  const nextMessages = [
    ...history,
    { role: "user" as const, content: safeTranscript.slice(0, 1_500) },
    { role: "assistant" as const, content: redactPii(reply).redacted.slice(0, 1_500) },
  ].slice(-input.env.SARVAM_HISTORY_MESSAGES);
  const nextMeta = updateDialogueMeta({
    previous: input.context.meta,
    reply,
    plan,
    safety,
    outputLanguage: outputLanguageCode,
  });

  return {
    transcript: transcription.transcript,
    reply,
    languageCode: outputLanguageCode,
    audioBase64,
    audioMimeType: "audio/wav" as const,
    dialogue: {
      objective: plan.objective,
      safetyLevel: safety.level,
      safetyConcern: safety.concern,
      safetyAction: decision.reason,
      modelSafetyCategory: inputSafety.category,
      replyTrimmed: shaped.trimmed || chat.finishReason === "length",
    },
    nextContext: { messages: nextMessages, meta: nextMeta },
    timings: {
      sttMs,
      chatMs,
      safetyMs,
      ttsMs,
      totalMs: Math.round(performance.now() - startedAt),
    },
  };
}
