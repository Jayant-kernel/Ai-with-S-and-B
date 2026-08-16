import type { ServerEnv } from "./env-schema";

export type HealthStatus = {
  status: "ok";
  openaiConfigured: boolean;
  groqConfigured: boolean;
  sarvamConfigured: boolean;
  geminiConfigured: boolean;
  databaseConfigured: boolean;
  liveVoiceAvailable: boolean;
};

export function buildHealthStatus(env: ServerEnv): HealthStatus {
  const openaiConfigured = Boolean(env.OPENAI_API_KEY);
  const groqConfigured = Boolean(env.GROQ_API_KEY);
  const sarvamConfigured = Boolean(env.SARVAM_API_KEY);
  const geminiConfigured = Boolean(env.GEMINI_API_KEY);

  return {
    status: "ok",
    openaiConfigured,
    groqConfigured,
    sarvamConfigured,
    geminiConfigured,
    databaseConfigured: Boolean(env.DATABASE_URL),
    liveVoiceAvailable:
      env.VOICE_ENGINE === "sarvam_chain" ? sarvamConfigured : openaiConfigured,
  };
}
