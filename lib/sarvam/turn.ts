import "server-only";

import { generateConversationReply } from "@/lib/ai/conversation";
import type { ModelMessage } from "@/lib/ai/openai-compatible";
import { planDialogue, updateDialogueMeta } from "@/lib/companion/dialogue-policy";
import { detectLanguagePreference } from "@/lib/companion/language-preference";
import { decideResponsePolicy } from "@/lib/companion/policy-engine";
import type { ProsodySignal } from "@/lib/companion/prosody";
import { classifySafety } from "@/lib/companion/safety";
import { observeSafety, type ModelSafetyAssessment } from "@/lib/companion/safety-observer";
import { shapeSpokenResponse } from "@/lib/companion/spoken-response";
import type { ServerEnv } from "@/lib/config/env-schema";
import { selectMemoryContext, type StoredMemory } from "@/lib/memory/context";
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

/**
 * The spoken output language. Deliberately does NOT follow the language Saaras
 * detected in the audio: a single English loanword in a Hindi sentence used to
 * flip detection to en-IN, which made Saathi answer in English and then keep
 * drifting there. Saathi's persona is Hindi-first, so output stays pinned to
 * the configured language (hi-IN) unless a previous turn established a
 * different preferred language for this conversation.
 */
export function ttsLanguage(preferred: string | undefined, fallback: string) {
  return SARVAM_TTS_LANGUAGES.includes(
    preferred as (typeof SARVAM_TTS_LANGUAGES)[number],
  )
    ? preferred!
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

export function memoryContextMessage(storedMemories: StoredMemory[]): ModelMessage | null {
  const facts = selectMemoryContext({ memories: storedMemories, privateMode: false });
  if (facts.length === 0) return null;
  return {
    role: "system",
    content: `What you remember about this person from past conversations:\n${
      facts.map((fact) => `- ${fact.text}`).join("\n")
    }`,
  };
}

export async function runSarvamTurn(input: {
  audio: Blob;
  filename: string;
  context: ConversationContext;
  speaker?: SarvamVoice;
  env: ServerEnv;
  /** Elder's approved, unexpired memories, already fetched by the caller.
   *  Defaults to none so this function stays testable without DB access --
   *  fetching stays at the route/pipeline layer, this is pure orchestration
   *  over already-resolved inputs. */
  storedMemories?: StoredMemory[];
  /** Level-trace summary for this turn's recording, already decoded by the
   *  caller. Optional: a browser that never started the input meter (or an
   *  older client) simply gets the text-only dialogue policy. */
  prosody?: ProsodySignal;
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
    prosody: input.prosody,
  });

  const memoryMessage = memoryContextMessage(input.storedMemories ?? []);
  const messages: ModelMessage[] = [
    { role: "system", content: COMPANION_INSTRUCTIONS },
    ...(memoryMessage ? [memoryMessage] : []),
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
    // Enforced deterministically, not just requested in the prompt: the model
    // routinely answers a one-word turn with a paragraph, which is the main
    // thing that makes a companion sound like a machine. planDialogue sizes
    // this from the person's own conversational energy.
    maxSentences: plan.maxSentences,
    maxQuestions: plan.mayAskQuestion ? 1 : 0,
  });
  const safetyStartedAt = performance.now();
  const outputSafety = await observeSafety({
    phase: "output",
    text: shaped.spoken,
    env: input.env,
  });
  const outputLanguageCode = ttsLanguage(
    input.context.meta.preferredLanguage,
    input.env.SARVAM_TTS_LANGUAGE,
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
  // Nudged, not overridden, by how the elder's own turn sounded (see
  // dialogue-policy's vocalRegister) -- clamped back into Sarvam's accepted
  // range so a config already near an edge can't be pushed out of bounds.
  const scaledPace = Math.min(2, Math.max(0.5, input.env.SARVAM_TTS_PACE * plan.paceScale));
  const audioBase64 = await synthesizeWithSarvam(
    {
      text: reply,
      model: input.env.SARVAM_TTS_MODEL,
      languageCode: outputLanguageCode,
      speaker: input.speaker ?? input.env.SARVAM_TTS_SPEAKER,
      pace: scaledPace,
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
    // Read from the raw transcript's script, not Saaras's language guess --
    // see detectLanguagePreference. This is what lets the elder move the
    // conversation to English (and back) and have it stick.
    detectedLanguage: detectLanguagePreference(transcription.transcript),
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
