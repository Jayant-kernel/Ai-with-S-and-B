import { readFile } from "node:fs/promises";

function readEnvFile(source) {
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
        return [key, value];
      }),
  );
}

const env = readEnvFile(await readFile(new URL("../.env.local", import.meta.url), "utf8"));
const apiKey = env.SARVAM_API_KEY;
if (!apiKey) throw new Error("SARVAM_API_KEY is missing from .env.local");

const seedResponse = await fetch("https://api.sarvam.ai/text-to-speech", {
  method: "POST",
  headers: {
    "api-subscription-key": apiKey,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    text: "नमस्ते साथी, आज मेरा दिन अच्छा था।",
    target_language_code: "hi-IN",
    speaker: "ritu",
    pace: 0.85,
    model: "bulbul:v3",
    output_audio_codec: "wav",
  }),
});
if (!seedResponse.ok) {
  await seedResponse.body?.cancel();
  throw new Error(`Sarvam seed TTS failed with HTTP ${seedResponse.status}`);
}
const seed = await seedResponse.json();
const audioBytes = Buffer.from(seed.audios[0], "base64");
const form = new FormData();
form.set("audio", new Blob([audioBytes], { type: "audio/wav" }), "smoke-test.wav");

const turnResponse = await fetch("http://localhost:3000/api/sarvam/turn", {
  method: "POST",
  headers: { Origin: "http://localhost:3000" },
  body: form,
});
const turn = await turnResponse.json();
console.log(`turn_http_status=${turnResponse.status}`);
if (!turnResponse.ok) {
  console.log(`turn_error_code=${turn.error?.code ?? "unknown"}`);
  console.log(`turn_error_message=${turn.error?.message ?? "unknown"}`);
  process.exitCode = 1;
} else {
  console.log(`transcript=${turn.transcript}`);
  console.log(`reply=${turn.reply}`);
  console.log(`language=${turn.languageCode}`);
  console.log(`stt_ms=${turn.timings.sttMs}`);
  console.log(`chat_ms=${turn.timings.chatMs}`);
  console.log(`tts_ms=${turn.timings.ttsMs}`);
  console.log(`total_ms=${turn.timings.totalMs}`);
  console.log(`reply_audio_base64_chars=${turn.audioBase64.length}`);
  console.log(`signed_context_present=${Boolean(turn.conversationState)}`);
}
