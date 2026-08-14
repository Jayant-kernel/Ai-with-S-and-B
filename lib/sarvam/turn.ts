import "server-only";

import { planDialogue, updateDialogueMeta } from "@/lib/companion/dialogue-policy";
import { classifySafety } from "@/lib/companion/safety";
import { shapeSpokenResponse } from "@/lib/companion/spoken-response";
import type { ServerEnv } from "@/lib/config/env-schema";
import { COMPANION_INSTRUCTIONS } from "@/lib/realtime/settings";
import {
  chatWithSarvam,
  type SarvamMessage,
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

  const history = boundedHistory(input.context.messages, input.env.SARVAM_HISTORY_MESSAGES);
  const safety = classifySafety(transcription.transcript);
  const plan = planDialogue({
    transcript: transcription.transcript,
    history,
    meta: input.context.meta,
    safety,
  });

  const messages: SarvamMessage[] = [
    { role: "system", content: COMPANION_INSTRUCTIONS },
    { role: "system", content: plan.directive },
    ...history,
    { role: "user", content: transcription.transcript },
  ];
  const chatStartedAt = performance.now();
  const chat = await chatWithSarvam(
    { model: input.env.SARVAM_CHAT_MODEL, messages },
    clientOptions,
  );
  const chatMs = Math.round(performance.now() - chatStartedAt);

  const shaped = shapeSpokenResponse(chat.content, {
    maxSentences: plan.objective === "SAFETY_CHECK" ? 3 : 2,
    maxQuestions: plan.mayAskQuestion ? 1 : 0,
  });
  const reply = shaped.spoken;

  const outputLanguageCode = ttsLanguage(
    transcription.languageCode,
    input.context.meta.preferredLanguage || input.env.SARVAM_TTS_LANGUAGE,
  );
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
    { role: "user" as const, content: transcription.transcript.slice(0, 1_500) },
    { role: "assistant" as const, content: reply.slice(0, 1_500) },
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
      replyTrimmed: shaped.trimmed || chat.finishReason === "length",
    },
    nextContext: { messages: nextMessages, meta: nextMeta },
    timings: {
      sttMs,
      chatMs,
      ttsMs,
      totalMs: Math.round(performance.now() - startedAt),
    },
  };
}
