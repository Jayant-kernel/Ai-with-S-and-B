import { describe, expect, it } from "vitest";

import {
  calculateRealtimeCost,
  percentile,
  readUsageFromResponseDone,
} from "../../lib/realtime/usage";

describe("Realtime usage", () => {
  it("reads audio and cache details from response.done", () => {
    const usage = readUsageFromResponseDone({
      type: "response.done",
      response: {
        usage: {
          input_tokens: 200,
          output_tokens: 80,
          input_token_details: {
            text_tokens: 100,
            audio_tokens: 100,
            cached_tokens: 50,
            cached_tokens_details: { text_tokens: 20, audio_tokens: 30 },
          },
          output_token_details: { text_tokens: 20, audio_tokens: 60 },
        },
      },
    });

    expect(usage).toEqual({
      inputAudio: 100,
      inputText: 100,
      cachedAudio: 30,
      cachedText: 20,
      outputAudio: 60,
      outputText: 20,
    });
  });

  it("calculates mini-model USD and INR estimates", () => {
    const cost = calculateRealtimeCost(
      {
        inputAudio: 100,
        inputText: 100,
        cachedAudio: 20,
        cachedText: 20,
        outputAudio: 50,
        outputText: 10,
      },
      "gpt-realtime-2.1-mini",
      80,
    );

    expect(cost.usd).toBeCloseTo(0.0018792, 7);
    expect(cost.inr).toBeCloseTo(cost.usd * 80, 7);
  });

  it("reports median and p95 latency", () => {
    expect(percentile([100, 200, 300, 400], 0.5)).toBe(200);
    expect(percentile([100, 200, 300, 400], 0.95)).toBe(400);
    expect(percentile([], 0.5)).toBeNull();
  });
});
