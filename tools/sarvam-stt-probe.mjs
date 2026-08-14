import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { pathToFileURL } from "node:url";

function readEnvFile(source) {
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [
          line.slice(0, separator).trim(),
          line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2"),
        ];
      }),
  );
}

const filePath = process.argv[2];
if (!filePath) throw new Error("Usage: node tools/sarvam-stt-probe.mjs <audio-file> [mime-type]");
const env = readEnvFile(await readFile(new URL("../.env.local", import.meta.url), "utf8"));
if (!env.SARVAM_API_KEY) throw new Error("SARVAM_API_KEY is missing from .env.local");

const mimeByExtension = {
  ".aac": "audio/aac",
  ".m4a": "audio/mp4",
  ".mp4": "audio/mp4",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
};
const bytes = await readFile(pathToFileURL(filePath));
const mimeType = process.argv[3] || mimeByExtension[extname(filePath).toLowerCase()] || "application/octet-stream";
const useLocalRoute = process.argv.includes("--local-route");
const form = new FormData();
form.set(useLocalRoute ? "audio" : "file", new Blob([bytes], { type: mimeType }), basename(filePath));
if (!useLocalRoute) {
  form.set("model", "saaras:v3");
  form.set("mode", "codemix");
  form.set("language_code", "unknown");
}

const response = await fetch(
  useLocalRoute
    ? "http://localhost:3000/api/sarvam/turn"
    : "https://api.sarvam.ai/speech-to-text",
  {
  method: "POST",
  headers: useLocalRoute
    ? { Origin: "http://localhost:3000" }
    : { "api-subscription-key": env.SARVAM_API_KEY },
  body: form,
  },
);
const responseText = await response.text();
const redacted = responseText.replaceAll(env.SARVAM_API_KEY, "[redacted]");
console.log(`file=${basename(filePath)}`);
console.log(`bytes=${bytes.length}`);
console.log(`mime=${mimeType}`);
console.log(`status=${response.status}`);
if (useLocalRoute && response.ok) {
  const turn = JSON.parse(responseText);
  console.log(`transcript=${turn.transcript}`);
  console.log(`reply=${turn.reply}`);
  console.log(`total_ms=${turn.timings?.totalMs}`);
  console.log(`reply_audio_base64_chars=${turn.audioBase64?.length ?? 0}`);
} else {
  console.log(`response=${redacted.slice(0, 1_000)}`);
}
if (!response.ok) process.exitCode = 1;
