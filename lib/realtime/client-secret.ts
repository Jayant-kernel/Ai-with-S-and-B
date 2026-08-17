import "server-only";

import { z } from "zod";

import { timeContextInstruction } from "@/lib/companion/time-of-day";

import { COMPANION_INSTRUCTIONS, REALTIME_TRUNCATION, type RealtimeModel } from "./settings";

// Slightly under 1.0 so the companion speaks a little more slowly than the
// model's default -- easier to follow for an older listener, without sounding
// artificially dragged out.
const COMPANION_SPEECH_SPEED = 0.95;

const clientSecretResponseSchema = z.object({
  value: z.string().min(1),
});

export class RealtimeUpstreamError extends Error {
  constructor(public readonly status: number) {
    super("OpenAI Realtime client-secret request failed");
  }
}

type CreateClientSecretOptions = {
  apiKey: string;
  model: RealtimeModel;
  voice: string;
  reasoningEffort: "low" | "medium" | "high";
  safetyIdentifier: string;
  fetchImplementation?: typeof fetch;
};

export async function createRealtimeClientSecret({
  apiKey,
  model,
  voice,
  reasoningEffort,
  safetyIdentifier,
  fetchImplementation = fetch,
}: CreateClientSecretOptions) {
  const response = await fetchImplementation(
    "https://api.openai.com/v1/realtime/client_secrets",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": safetyIdentifier,
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model,
          // Time context is appended per session so the companion knows
          // whether it is morning/afternoon/evening/night in India without
          // being told, and which meal is natural to ask about if the
          // conversation goes quiet.
          instructions: `${COMPANION_INSTRUCTIONS}\n\n${timeContextInstruction()}`,
          output_modalities: ["audio"],
          audio: {
            input: {
              noise_reduction: { type: "far_field" },
              transcription: { model: "gpt-4o-mini-transcribe" },
              turn_detection: {
                type: "semantic_vad",
                eagerness: "low",
                create_response: true,
                interrupt_response: true,
              },
            },
            output: { voice, speed: COMPANION_SPEECH_SPEED },
          },
          reasoning: { effort: reasoningEffort },
          truncation: REALTIME_TRUNCATION,
        },
      }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new RealtimeUpstreamError(response.status);
  }

  const parsed = clientSecretResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new RealtimeUpstreamError(502);
  }

  return parsed.data.value;
}
