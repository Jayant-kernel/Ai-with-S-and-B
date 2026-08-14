import { z } from "zod";

import { REALTIME_MINI_MODEL, type RealtimeModel } from "./settings";

const usageSchema = z.object({
  input_tokens: z.number().nonnegative().default(0),
  output_tokens: z.number().nonnegative().default(0),
  input_token_details: z
    .object({
      text_tokens: z.number().nonnegative().default(0),
      audio_tokens: z.number().nonnegative().default(0),
      cached_tokens: z.number().nonnegative().default(0),
      cached_tokens_details: z
        .object({
          text_tokens: z.number().nonnegative().default(0),
          audio_tokens: z.number().nonnegative().default(0),
        })
        .partial()
        .default({}),
    })
    .partial()
    .default({}),
  output_token_details: z
    .object({
      text_tokens: z.number().nonnegative().default(0),
      audio_tokens: z.number().nonnegative().default(0),
    })
    .partial()
    .default({}),
});

export type RealtimeUsageTotals = {
  inputAudio: number;
  inputText: number;
  cachedAudio: number;
  cachedText: number;
  outputAudio: number;
  outputText: number;
};

export const EMPTY_USAGE: RealtimeUsageTotals = {
  inputAudio: 0,
  inputText: 0,
  cachedAudio: 0,
  cachedText: 0,
  outputAudio: 0,
  outputText: 0,
};

export function readUsageFromResponseDone(event: unknown): RealtimeUsageTotals | null {
  if (!event || typeof event !== "object") return null;
  const candidate = event as { type?: unknown; response?: { usage?: unknown } };
  if (candidate.type !== "response.done") return null;

  const parsed = usageSchema.safeParse(candidate.response?.usage);
  if (!parsed.success) return null;

  const input = parsed.data.input_token_details;
  const cached = input.cached_tokens_details ?? {};

  return {
    inputAudio: input.audio_tokens ?? 0,
    inputText: input.text_tokens ?? 0,
    cachedAudio: cached.audio_tokens ?? 0,
    cachedText: cached.text_tokens ?? 0,
    outputAudio: parsed.data.output_token_details.audio_tokens ?? 0,
    outputText: parsed.data.output_token_details.text_tokens ?? 0,
  };
}

export function addUsage(
  current: RealtimeUsageTotals,
  next: RealtimeUsageTotals,
): RealtimeUsageTotals {
  return {
    inputAudio: current.inputAudio + next.inputAudio,
    inputText: current.inputText + next.inputText,
    cachedAudio: current.cachedAudio + next.cachedAudio,
    cachedText: current.cachedText + next.cachedText,
    outputAudio: current.outputAudio + next.outputAudio,
    outputText: current.outputText + next.outputText,
  };
}

const PRICE_PER_MILLION = {
  mini: {
    inputAudio: 10,
    cachedAudio: 0.3,
    outputAudio: 20,
    inputText: 0.6,
    cachedText: 0.06,
    outputText: 2.4,
  },
  quality: {
    inputAudio: 32,
    cachedAudio: 0.4,
    outputAudio: 64,
    inputText: 4,
    cachedText: 0.4,
    outputText: 24,
  },
} as const;

export const USD_TO_INR_ESTIMATE = 87;

export function calculateRealtimeCost(
  usage: RealtimeUsageTotals,
  model: RealtimeModel,
  usdToInr = USD_TO_INR_ESTIMATE,
) {
  const price = model === REALTIME_MINI_MODEL ? PRICE_PER_MILLION.mini : PRICE_PER_MILLION.quality;
  const uncachedAudio = Math.max(0, usage.inputAudio - usage.cachedAudio);
  const uncachedText = Math.max(0, usage.inputText - usage.cachedText);
  const usd =
    (uncachedAudio * price.inputAudio +
      usage.cachedAudio * price.cachedAudio +
      usage.outputAudio * price.outputAudio +
      uncachedText * price.inputText +
      usage.cachedText * price.cachedText +
      usage.outputText * price.outputText) /
    1_000_000;

  return { usd, inr: usd * usdToInr };
}

export function percentile(values: number[], percentage: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * percentage) - 1);
  return sorted[Math.max(0, index)];
}
