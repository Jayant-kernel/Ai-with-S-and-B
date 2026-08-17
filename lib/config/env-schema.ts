import { z } from "zod";

import { SARVAM_TTS_LANGUAGES, SARVAM_VOICES } from "@/lib/sarvam/settings";

const optionalSecret = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(1).optional(),
);

const envBoolean = (defaultValue: boolean) =>
  z
    .enum(["true", "false"])
    .default(String(defaultValue) as "true" | "false")
    .transform((value) => value === "true");

export const serverEnvSchema = z.object({
  OPENAI_API_KEY: optionalSecret,
  GROQ_API_KEY: optionalSecret,
  SARVAM_API_KEY: optionalSecret,
  GEMINI_API_KEY: optionalSecret,
  CONVERSATION_STATE_SECRET: optionalSecret,
  // No fallback derivation, unlike CONVERSATION_STATE_SECRET: memory needs
  // a dedicated encryption key so rotating an unrelated secret can never
  // silently reveal or invalidate stored memory content.
  MEMORY_ENCRYPTION_KEY: optionalSecret,
  VOICE_ENGINE: z.enum(["sarvam_chain", "openai_realtime"]).default("sarvam_chain"),
  OPENAI_REALTIME_MODEL: z.string().default("gpt-realtime-2.1-mini"),
  OPENAI_REALTIME_DEV_MODEL: z.string().default("gpt-realtime-2.1"),
  // cedar is the male-sounding Realtime voice; marin reads female. Saathi is
  // written as a calm man in his forties, so cedar is the default.
  OPENAI_REALTIME_VOICE: z.string().default("cedar"),
  OPENAI_REASONING_EFFORT: z.enum(["low", "medium", "high"]).default("low"),
  OPENAI_TURN_DETECTION: z.literal("semantic_vad").default("semantic_vad"),
  CONVERSATION_PROVIDER: z.enum(["auto", "sarvam", "groq", "openai"]).default("auto"),
  SAFETY_PROVIDER: z.enum(["auto", "deterministic", "groq", "openai"]).default("auto"),
  GROQ_BASE_URL: z.url().default("https://api.groq.com/openai/v1"),
  GROQ_CONVERSATION_MODEL: z.string().default("llama-3.3-70b-versatile"),
  GROQ_SAFETY_MODEL: z.string().default("openai/gpt-oss-safeguard-20b"),
  OPENAI_BASE_URL: z.url().default("https://api.openai.com/v1"),
  OPENAI_CONVERSATION_MODEL: z.string().default("gpt-5-mini"),
  OPENAI_SAFETY_MODEL: z.string().default("gpt-5-mini"),
  MODEL_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  SAFETY_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(4_000),
  SARVAM_STT_MODEL: z.string().default("saaras:v3"),
  SARVAM_STT_LANGUAGE: z.string().default("unknown"),
  SARVAM_CHAT_MODEL: z.string().default("sarvam-105b-conversations"),
  SARVAM_TTS_MODEL: z.string().default("bulbul:v3"),
  SARVAM_TTS_LANGUAGE: z.enum(SARVAM_TTS_LANGUAGES).default("hi-IN"),
  // shubh is the male Bulbul speaker; ritu/priya/simran read female. Matches
  // the male companion persona in COMPANION_INSTRUCTIONS.
  SARVAM_TTS_SPEAKER: z.enum(SARVAM_VOICES).default("shubh"),
  // 0.81 is ~95% of the previous 0.85 -- a small extra slowdown so an older
  // listener has more time to follow each phrase.
  SARVAM_TTS_PACE: z.coerce.number().min(0.5).max(2).default(0.81),
  SARVAM_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(120_000).default(45_000),
  SARVAM_MAX_AUDIO_BYTES: z.coerce.number().int().min(64_000).max(20_000_000).default(8_000_000),
  SARVAM_HISTORY_MESSAGES: z.coerce.number().int().min(0).max(20).default(16),
  // No default: there is no database client in this project yet (memory is
  // still `lib/memory/*` in-process logic, gated off by ENABLE_MEMORY).
  // A default placeholder here would make health.ts's databaseConfigured
  // report true even though nothing is actually connected.
  DATABASE_URL: optionalSecret,
  APP_ORIGIN: z.url().default("http://localhost:3000"),
  STORE_RAW_TRANSCRIPTS: envBoolean(false),
  ENABLE_MEMORY: envBoolean(false),
  ENABLE_SAFETY_MONITOR: envBoolean(true),
  ENABLE_REMINDERS: envBoolean(false),
  ENABLE_SARVAM_FALLBACK: envBoolean(false),
  ENABLE_VOICE_CLONE: z.literal("false").default("false").transform(() => false),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(input: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(input);

  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(`Invalid server configuration: ${fields.join(", ")}`);
  }

  return result.data;
}
