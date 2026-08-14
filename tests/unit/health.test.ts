import { describe, expect, it } from "vitest";

import { buildHealthStatus } from "../../lib/config/health";
import { parseServerEnv } from "../../lib/config/env-schema";

describe("health status", () => {
  it("returns booleans and never returns credentials", () => {
    const openaiKey = "openai-private-test-value";
    const sarvamKey = "sarvam-private";
    const geminiKey = "gemini-private";
    const status = buildHealthStatus(
      parseServerEnv({
        OPENAI_API_KEY: openaiKey,
        SARVAM_API_KEY: sarvamKey,
        GEMINI_API_KEY: geminiKey,
      }),
    );
    const serialized = JSON.stringify(status);

    expect(status).toEqual({
      status: "ok",
      openaiConfigured: true,
      sarvamConfigured: true,
      geminiConfigured: true,
      databaseConfigured: true,
      liveVoiceAvailable: true,
    });
    expect(serialized).not.toContain(openaiKey);
    expect(serialized).not.toContain(sarvamKey);
    expect(serialized).not.toContain(geminiKey);
  });

  it("reports the selected engine as unavailable when its key is missing", () => {
    const sarvamPrimary = buildHealthStatus(
      parseServerEnv({ OPENAI_API_KEY: "openai-only" }),
    );
    const openaiPrimary = buildHealthStatus(
      parseServerEnv({ VOICE_ENGINE: "openai_realtime", SARVAM_API_KEY: "sarvam-only" }),
    );

    expect(sarvamPrimary.liveVoiceAvailable).toBe(false);
    expect(openaiPrimary.liveVoiceAvailable).toBe(false);
  });
});
