import { after, NextResponse } from "next/server";
import { z } from "zod";

import { getServerEnv } from "@/lib/config/server-env";
import { getPool } from "@/lib/db/pool";
import type { StoredMemory } from "@/lib/memory/context";
import {
  createElderToken,
  ELDER_COOKIE_MAX_AGE_SECONDS,
  ELDER_COOKIE_NAME,
  hashElderToken,
  readElderTokenFromCookieHeader,
} from "@/lib/memory/elder-session";
import { loadStoredMemoriesForTurn, runMemoryPipeline } from "@/lib/memory/pipeline";
import type { QueryFn } from "@/lib/memory/repository";
import { isSameOrigin, LocalRateLimiter } from "@/lib/realtime/request-policy";
import { SarvamNoSpeechError, SarvamUpstreamError } from "@/lib/sarvam/client";
import {
  ConversationStateError,
  createConversationState,
  readConversationState,
} from "@/lib/sarvam/conversation-state";
import { emptyConversationContext, SARVAM_VOICES } from "@/lib/sarvam/settings";
import { runSarvamTurn } from "@/lib/sarvam/turn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_AUDIO_TYPES = new Set([
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
]);
const speakerSchema = z.enum(SARVAM_VOICES);
const rateLimiter = new LocalRateLimiter(12, 60_000);

function errorResponse(status: number, code: string, message: string, retryAfter?: number) {
  return NextResponse.json(
    { error: { code, message } },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}),
      },
    },
  );
}

function upstreamMessage(error: SarvamUpstreamError) {
  if (error.status === 401 || error.status === 403) {
    return [502, "authentication_failed", "The Sarvam API key was not accepted."] as const;
  }
  if (error.status === 402) {
    return [503, "billing_required", "Sarvam API credits are required."] as const;
  }
  if (error.status === 429) {
    return [503, "sarvam_rate_limited", "Sarvam is busy or rate-limited. Please retry shortly."] as const;
  }
  if (error.status === 504) {
    return [504, "sarvam_timeout", "The voice service took too long. Please retry."] as const;
  }
  if (
    error.service === "speech-to-text" &&
    (error.status === 400 || error.status === 415 || error.status === 422)
  ) {
    return [
      422,
      "audio_not_readable",
      "The recorded audio format could not be read. Please record the turn again.",
    ] as const;
  }
  return [502, "sarvam_failed", `The ${error.service} step could not finish.`] as const;
}

export async function POST(request: Request) {
  const env = getServerEnv();

  if (!isSameOrigin(request.headers.get("origin"), env.APP_ORIGIN)) {
    return errorResponse(403, "origin_not_allowed", "This request must come from the Saathi app.");
  }
  if (!env.SARVAM_API_KEY) {
    return errorResponse(503, "not_configured", "Sarvam voice is not configured on this server.");
  }
  const stateSecret = env.CONVERSATION_STATE_SECRET ?? env.SARVAM_API_KEY;

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > env.SARVAM_MAX_AUDIO_BYTES + 200_000) {
    return errorResponse(413, "audio_too_large", "Please keep each voice turn under 30 seconds.");
  }

  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const rateKey = forwardedFor || request.headers.get("x-real-ip") || "local-browser";
  const rate = rateLimiter.consume(rateKey);
  if (!rate.allowed) {
    return errorResponse(
      429,
      "rate_limited",
      "Please wait a moment before sending another voice turn.",
      rate.retryAfterSeconds,
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse(400, "invalid_request", "The voice turn could not be read.");
  }

  const audio = form.get("audio");
  if (!(audio instanceof File) || audio.size === 0) {
    return errorResponse(400, "audio_required", "Record a short message before sending it.");
  }
  if (audio.size > env.SARVAM_MAX_AUDIO_BYTES) {
    return errorResponse(413, "audio_too_large", "Please keep each voice turn under 30 seconds.");
  }
  const normalizedAudioType = audio.type.split(";", 1)[0]?.trim().toLowerCase();
  if (!normalizedAudioType || !ALLOWED_AUDIO_TYPES.has(normalizedAudioType)) {
    return errorResponse(415, "audio_type_not_supported", "This browser audio format is not supported.");
  }

  const rawState = form.get("conversationState");
  if (rawState !== null && typeof rawState !== "string") {
    return errorResponse(400, "invalid_history", "The conversation context is not valid.");
  }
  let context;
  try {
    context = readConversationState(rawState, stateSecret);
  } catch (error) {
    if (error instanceof ConversationStateError) {
      context = emptyConversationContext();
    } else {
      return errorResponse(400, "invalid_history", "The conversation context is not valid.");
    }
  }

  const rawSpeaker = form.get("speaker");
  const parsedSpeaker = rawSpeaker
    ? speakerSchema.safeParse(rawSpeaker)
    : { success: true as const, data: undefined };
  if (!parsedSpeaker.success) {
    return errorResponse(400, "invalid_speaker", "That voice is not available.");
  }

  // No cookie is read or minted, and no DB call happens, unless memory is
  // explicitly turned on -- this keeps today's behavior unchanged by
  // default. When it is on but DATABASE_URL/MEMORY_ENCRYPTION_KEY aren't
  // both set, the elder still gets a cookie (so it's ready once the rest
  // is configured) but no memories are fetched or written.
  let elderToken: string | null = null;
  let mintedElderToken = false;
  let storedMemories: StoredMemory[] = [];
  if (env.ENABLE_MEMORY) {
    elderToken = readElderTokenFromCookieHeader(request.headers.get("cookie"));
    if (!elderToken) {
      elderToken = createElderToken();
      mintedElderToken = true;
    }
    const pool = getPool(env);
    const key = env.MEMORY_ENCRYPTION_KEY;
    if (pool && key) {
      try {
        const query: QueryFn = (text, params) => pool.query(text, params);
        // Read-only: this turn hasn't happened yet and might still fail, so
        // nothing here may create an elder row (see loadStoredMemoriesForTurn's
        // doc comment). The row itself is only ever created after success,
        // inside runMemoryPipeline's after() callback below.
        storedMemories = await loadStoredMemoriesForTurn({
          query,
          key,
          elderHash: hashElderToken(elderToken),
        });
      } catch (error) {
        // Best-effort: a memory read failure must never block the turn --
        // but stays visible in logs rather than silently vanishing.
        console.warn("[memory] pre-turn memory read failed:", error);
        storedMemories = [];
      }
    }
  }

  try {
    const result = await runSarvamTurn({
      audio,
      filename: audio.name || "voice-turn.webm",
      context,
      speaker: parsedSpeaker.data,
      env,
      storedMemories,
    });
    const { nextContext, ...response } = result;
    let nextState;
    try {
      nextState = createConversationState(nextContext, stateSecret);
    } catch {
      nextState = createConversationState(emptyConversationContext(), stateSecret);
    }
    const nextResponse = NextResponse.json({
      ...response,
      conversationState: nextState,
    }, {
      headers: { "Cache-Control": "no-store" },
    });

    if (elderToken) {
      if (mintedElderToken) {
        nextResponse.cookies.set(ELDER_COOKIE_NAME, elderToken, {
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          maxAge: ELDER_COOKIE_MAX_AGE_SECONDS,
          path: "/",
        });
      }
      const elderHash = hashElderToken(elderToken);
      after(() =>
        runMemoryPipeline({
          elderHash,
          transcript: result.transcript,
          reply: result.reply,
          preferredLanguage: result.languageCode,
          env,
        }).catch(() => {}),
      );
    }

    return nextResponse;
  } catch (error) {
    if (error instanceof SarvamNoSpeechError) {
      return errorResponse(
        422,
        "no_speech_detected",
        "I could not hear any speech. Check the microphone and try again.",
      );
    }
    if (error instanceof SarvamUpstreamError) {
      const [status, code, message] = upstreamMessage(error);
      return errorResponse(status, code, message);
    }
    return errorResponse(502, "voice_turn_failed", "Saathi could not finish this voice turn.");
  }
}
