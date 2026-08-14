import "server-only";

import { z } from "zod";

const SARVAM_API_ORIGIN = "https://api.sarvam.ai";

const transcriptionResponseSchema = z.object({
  transcript: z.string(),
  language_code: z.string().optional(),
  request_id: z.string().optional(),
});

const chatResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string().nullable(),
      }),
      finish_reason: z.string().nullable().optional(),
    }),
  ).min(1),
});

const speechResponseSchema = z.object({
  audios: z.array(z.string().min(1)).min(1),
  request_id: z.string().optional(),
});

export type SarvamMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export class SarvamUpstreamError extends Error {
  constructor(
    readonly service: "speech-to-text" | "chat" | "text-to-speech",
    readonly status: number,
    message = `Sarvam ${service} request failed.`,
  ) {
    super(message);
    this.name = "SarvamUpstreamError";
  }
}

export class SarvamNoSpeechError extends Error {
  constructor() {
    super("Sarvam could not detect speech in the recording.");
    this.name = "SarvamNoSpeechError";
  }
}

type SarvamClientOptions = {
  apiKey: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
};

async function sarvamFetchJson(
  path: string,
  init: RequestInit,
  service: SarvamUpstreamError["service"],
  options: SarvamClientOptions,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const headers = new Headers(init.headers);
    headers.set("api-subscription-key", options.apiKey);
    const response = await (options.fetchImpl ?? fetch)(`${SARVAM_API_ORIGIN}${path}`, {
      ...init,
      headers,
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new SarvamUpstreamError(service, response.status);
    }
    try {
      return await response.json() as unknown;
    } catch {
      throw new SarvamUpstreamError(service, 502, `Sarvam ${service} returned invalid JSON.`);
    }
  } catch (error) {
    if (error instanceof SarvamUpstreamError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new SarvamUpstreamError(service, 504, `Sarvam ${service} timed out.`);
    }
    throw new SarvamUpstreamError(service, 502);
  } finally {
    clearTimeout(timeout);
  }
}

export async function transcribeWithSarvam(
  input: {
    audio: Blob;
    filename: string;
    model: string;
    languageCode: string;
  },
  options: SarvamClientOptions,
) {
  const form = new FormData();
  const normalizedMimeType = input.audio.type.split(";", 1)[0]?.trim().toLowerCase();
  const uploadAudio = normalizedMimeType && normalizedMimeType !== input.audio.type
    ? input.audio.slice(0, input.audio.size, normalizedMimeType)
    : input.audio;
  form.set("file", uploadAudio, input.filename);
  form.set("model", input.model);
  form.set("mode", "codemix");
  form.set("language_code", input.languageCode);

  const body = await sarvamFetchJson(
    "/speech-to-text",
    { method: "POST", body: form },
    "speech-to-text",
    options,
  );
  const parsed = transcriptionResponseSchema.safeParse(body);
  if (!parsed.success) throw new SarvamUpstreamError("speech-to-text", 502);
  if (!parsed.data.transcript.trim()) throw new SarvamNoSpeechError();

  return {
    transcript: parsed.data.transcript.trim(),
    languageCode: parsed.data.language_code,
  };
}

export async function chatWithSarvam(
  input: { model: string; messages: SarvamMessage[] },
  options: SarvamClientOptions,
) {
  const body = await sarvamFetchJson(
    "/v1/chat/completions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        reasoning_effort: null,
        max_tokens: 220,
        temperature: 0.4,
      }),
    },
    "chat",
    options,
  );
  const parsed = chatResponseSchema.safeParse(body);
  const content = parsed.success ? parsed.data.choices[0]?.message.content?.trim() : "";
  if (!content) {
    throw new SarvamUpstreamError("chat", 502, "Sarvam returned no reply.");
  }
  return {
    content,
    finishReason: parsed.success ? parsed.data.choices[0]?.finish_reason ?? null : null,
  };
}

export async function synthesizeWithSarvam(
  input: {
    text: string;
    model: string;
    languageCode: string;
    speaker: string;
    pace: number;
  },
  options: SarvamClientOptions,
) {
  const body = await sarvamFetchJson(
    "/text-to-speech",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: input.text,
        target_language_code: input.languageCode,
        speaker: input.speaker,
        pace: input.pace,
        model: input.model,
        output_audio_codec: "wav",
      }),
    },
    "text-to-speech",
    options,
  );
  const parsed = speechResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new SarvamUpstreamError("text-to-speech", 502, "Sarvam returned no audio.");
  }
  return parsed.data.audios[0];
}
