import { describe, expect, it } from "vitest";

import { parseServerEnv } from "../../lib/config/env-schema";

describe("server environment", () => {
  it("starts safely when API keys are absent", () => {
    const env = parseServerEnv({});

    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(env.STORE_RAW_TRANSCRIPTS).toBe(false);
    expect(env.ENABLE_VOICE_CLONE).toBe(false);
    expect(env.OPENAI_REALTIME_MODEL).toBe("gpt-realtime-2.1-mini");
    expect(env.VOICE_ENGINE).toBe("sarvam_chain");
    expect(env.SARVAM_STT_MODEL).toBe("saaras:v3");
    expect(env.SARVAM_CHAT_MODEL).toBe("sarvam-105b-conversations");
    expect(env.SARVAM_TTS_MODEL).toBe("bulbul:v3");
  });

  it("parses feature flags explicitly", () => {
    const env = parseServerEnv({ ENABLE_MEMORY: "true" });

    expect(env.ENABLE_MEMORY).toBe(true);
    expect(env.ENABLE_REMINDERS).toBe(false);
  });

  it("does not include secret values in validation errors", () => {
    const secret = "private-test-value-that-must-never-appear";

    expect(() =>
      parseServerEnv({
        OPENAI_API_KEY: secret,
        ENABLE_MEMORY: "sometimes",
      }),
    ).toThrowError(/ENABLE_MEMORY/);

    try {
      parseServerEnv({ OPENAI_API_KEY: secret, ENABLE_MEMORY: "sometimes" });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});
