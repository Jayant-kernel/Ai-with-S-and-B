import { NextResponse } from "next/server";
import { z } from "zod";

import { getServerEnv } from "@/lib/config/server-env";
import {
  createRealtimeClientSecret,
  RealtimeUpstreamError,
} from "@/lib/realtime/client-secret";
import {
  createSafetyIdentifier,
  isSameOrigin,
  LocalRateLimiter,
} from "@/lib/realtime/request-policy";
import {
  REALTIME_MODELS,
  REALTIME_VOICES,
  type RealtimeModel,
} from "@/lib/realtime/settings";

const requestSchema = z.object({
  model: z.enum(REALTIME_MODELS).optional(),
  voice: z.enum(REALTIME_VOICES).optional(),
});

const rateLimiter = new LocalRateLimiter();

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

export async function POST(request: Request) {
  const env = getServerEnv();

  if (!isSameOrigin(request.headers.get("origin"), env.APP_ORIGIN)) {
    return errorResponse(403, "origin_not_allowed", "This request must come from the Saathi app.");
  }

  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const rateKey = forwardedFor || request.headers.get("x-real-ip") || "local-browser";
  const rate = rateLimiter.consume(rateKey);
  if (!rate.allowed) {
    return errorResponse(
      429,
      "rate_limited",
      "Please wait a moment before reconnecting.",
      rate.retryAfterSeconds,
    );
  }

  if (!env.OPENAI_API_KEY) {
    return errorResponse(503, "not_configured", "Live voice is not configured on this server.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_request", "The session request is not valid.");
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(400, "invalid_model", "That Realtime model is not available here.");
  }

  const configuredModels = new Set([
    env.OPENAI_REALTIME_MODEL,
    env.OPENAI_REALTIME_DEV_MODEL,
  ]);
  const requestedModel = parsed.data.model ?? env.OPENAI_REALTIME_MODEL;
  if (!configuredModels.has(requestedModel)) {
    return errorResponse(400, "invalid_model", "That Realtime model is not configured.");
  }

  try {
    const clientSecret = await createRealtimeClientSecret({
      apiKey: env.OPENAI_API_KEY,
      model: requestedModel as RealtimeModel,
      voice: parsed.data.voice ?? env.OPENAI_REALTIME_VOICE,
      reasoningEffort: env.OPENAI_REASONING_EFFORT,
      safetyIdentifier: createSafetyIdentifier(env.APP_ORIGIN),
    });

    return NextResponse.json(
      { clientSecret },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof RealtimeUpstreamError) {
      if (error.status === 401 || error.status === 403) {
        return errorResponse(502, "authentication_failed", "OpenAI authentication failed.");
      }
      if (error.status === 429) {
        return errorResponse(503, "openai_rate_limited", "OpenAI is busy. Please retry shortly.");
      }
      if (error.status === 402) {
        return errorResponse(503, "billing_required", "OpenAI API billing or credits are required.");
      }
    }

    return errorResponse(502, "session_failed", "Saathi could not start a voice session.");
  }
}
