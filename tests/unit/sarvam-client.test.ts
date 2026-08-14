import { describe, expect, it, vi } from "vitest";

import {
  chatWithSarvam,
  SarvamNoSpeechError,
  SarvamUpstreamError,
  synthesizeWithSarvam,
  transcribeWithSarvam,
} from "../../lib/sarvam/client";

const options = (fetchImpl: typeof fetch) => ({
  apiKey: "private-sarvam-test-key",
  timeoutMs: 5_000,
  fetchImpl,
});

describe("Sarvam API client", () => {
  it("sends audio as multipart and parses a codemix transcript", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("api-subscription-key")).toBe("private-sarvam-test-key");
      expect(init?.body).toBeInstanceOf(FormData);
      const form = init?.body as FormData;
      expect(form.get("model")).toBe("saaras:v3");
      expect(form.get("mode")).toBe("codemix");
      const uploadedAudio = form.get("file");
      expect(uploadedAudio).toBeInstanceOf(File);
      expect((uploadedAudio as File).type).toBe("audio/webm");
      return Response.json({ transcript: "Namaste ji", language_code: "hi-IN" });
    }) as unknown as typeof fetch;

    await expect(transcribeWithSarvam({
      audio: new Blob(["audio"], { type: "audio/webm;codecs=opus" }),
      filename: "turn.webm",
      model: "saaras:v3",
      languageCode: "unknown",
    }, options(fetchImpl))).resolves.toEqual({
      transcript: "Namaste ji",
      languageCode: "hi-IN",
    });
  });

  it("distinguishes a silent recording from an upstream failure", async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      transcript: "   ",
      language_code: "hi-IN",
    })) as unknown as typeof fetch;

    await expect(transcribeWithSarvam({
      audio: new Blob(["audio"], { type: "audio/webm" }),
      filename: "silent.webm",
      model: "saaras:v3",
      languageCode: "unknown",
    }, options(fetchImpl))).rejects.toBeInstanceOf(SarvamNoSpeechError);
  });

  it("uses the conversations model without paid reasoning tokens", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        model: "sarvam-105b-conversations",
        reasoning_effort: null,
        max_tokens: 220,
      });
      return Response.json({ choices: [{ message: { content: "Namaste ji." } }] });
    }) as unknown as typeof fetch;

    await expect(chatWithSarvam({
      model: "sarvam-105b-conversations",
      messages: [{ role: "user", content: "Namaste" }],
    }, options(fetchImpl))).resolves.toEqual({
      content: "Namaste ji.",
      finishReason: null,
    });
  });

  it("requests Bulbul v3 WAV audio", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        model: "bulbul:v3",
        speaker: "ritu",
        output_audio_codec: "wav",
      });
      return Response.json({ audios: ["UklGRg=="] });
    }) as unknown as typeof fetch;

    await expect(synthesizeWithSarvam({
      text: "Namaste ji.",
      model: "bulbul:v3",
      languageCode: "hi-IN",
      speaker: "ritu",
      pace: 0.85,
    }, options(fetchImpl))).resolves.toBe("UklGRg==");
  });

  it("reports status and service without exposing an upstream body", async () => {
    const fetchImpl = vi.fn(async () => new Response("secret diagnostic", { status: 429 })) as unknown as typeof fetch;

    try {
      await chatWithSarvam({
        model: "sarvam-105b-conversations",
        messages: [{ role: "user", content: "hello" }],
      }, options(fetchImpl));
      throw new Error("Expected request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(SarvamUpstreamError);
      expect(error).toMatchObject({ service: "chat", status: 429 });
      expect(String(error)).not.toContain("secret diagnostic");
    }
  });
});
