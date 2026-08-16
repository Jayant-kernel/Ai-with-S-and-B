import { describe, expect, it } from "vitest";

import { buildHealthStatus } from "../../lib/config/health";
import { parseServerEnv } from "../../lib/config/env-schema";

describe("health status", () => {
  it("returns booleans and never returns credentials", () => {
    const openaiKey = "openai-private-test-value";
    const sarvamKey = "sarvam-private";
    const geminiKey = "gemini-private";
    const groqKey = "groq-private";
    const status = buildHealthStatus(
      parseServerEnv({
        OPENAI_API_KEY: openaiKey,
        GROQ_API_KEY: groqKey,
        SARVAM_API_KEY: sarvamKey,
        GEMINI_API_KEY: geminiKey,
      }),
    );
    const serialized = JSON.stringify(status);

    expect(status).toEqual({
      status: "ok",
      openaiConfigured: true,
      groqConfigured: true,
      sarvamConfigured: true,
      geminiConfigured: true,
      databaseConfigured: false,
      liveVoiceAvailable: true,
    });
    expect(serialized).not.toContain(openaiKey);
    expect(serialized).not.toContain(groqKey);
    expect(serialized).not.toContain(sarvamKey);
    expect(serialized).not.toContain(geminiKey);
  });

  it("reports databaseConfigured only when a real connection string is set", () => {
    // Regression: DATABASE_URL used to default to "file:./dev.db", so this
    // was always true even though no database client exists in the project.
    const unset = buildHealthStatus(parseServerEnv({}));
    expect(unset.databaseConfigured).toBe(false);

    const configured = buildHealthStatus(
      parseServerEnv({ DATABASE_URL: "postgresql://user:pass@host/db" }),
    );
    expect(configured.databaseConfigured).toBe(true);
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
