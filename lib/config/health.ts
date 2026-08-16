import type { ServerEnv } from "./env-schema";

export type HealthStatus = {
  status: "ok";
  openaiConfigured: boolean;
  groqConfigured: boolean;
  sarvamConfigured: boolean;
  geminiConfigured: boolean;
  databaseConfigured: boolean;
  memoryConfigured: boolean;
  liveVoiceAvailable: boolean;
};

export function buildHealthStatus(env: ServerEnv): HealthStatus {
  const openaiConfigured = Boolean(env.OPENAI_API_KEY);
  const groqConfigured = Boolean(env.GROQ_API_KEY);
  const sarvamConfigured = Boolean(env.SARVAM_API_KEY);
  const geminiConfigured = Boolean(env.GEMINI_API_KEY);
  const databaseConfigured = Boolean(env.DATABASE_URL);

  return {
    status: "ok",
    openaiConfigured,
    groqConfigured,
    sarvamConfigured,
    geminiConfigured,
    databaseConfigured,
    // Distinct from databaseConfigured: memory also needs its own
    // dedicated encryption key and the feature flag on before the app
    // will actually read or write anything.
    memoryConfigured: env.ENABLE_MEMORY && databaseConfigured && Boolean(env.MEMORY_ENCRYPTION_KEY),
    liveVoiceAvailable:
      env.VOICE_ENGINE === "sarvam_chain" ? sarvamConfigured : openaiConfigured,
  };
}
