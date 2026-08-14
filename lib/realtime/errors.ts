const CREDENTIAL_PATTERN = /\b(?:ek|sk)[-_][A-Za-z0-9_-]{8,}\b/g;

function safeDetail(value: unknown, depth = 0): string {
  if (depth > 3 || value === null || typeof value === "undefined") return "";
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (typeof value !== "object") return "";

  const candidate = value as Record<string, unknown>;
  for (const key of ["message", "error", "detail", "reason"]) {
    const detail = safeDetail(candidate[key], depth + 1);
    if (detail) return detail;
  }

  const code = typeof candidate.code === "string" ? candidate.code : "";
  const type = typeof candidate.type === "string" ? candidate.type : "";
  return code || (type !== "error" ? type : "");
}

export function realtimeErrorDetail(error: unknown) {
  const detail = safeDetail(error)
    .replace(CREDENTIAL_PATTERN, "[credential]")
    .replace(/\s+/g, " ")
    .trim();

  return detail.slice(0, 240);
}

export function realtimeErrorMessage(error: unknown, debug = false) {
  const detail = realtimeErrorDetail(error);
  const normalized = detail.toLowerCase();

  let message = "The Realtime connection failed. Please reconnect.";
  if (
    normalized.includes("permission") ||
    normalized.includes("notallowed") ||
    normalized.includes("not allowed")
  ) {
    message = "Microphone access is blocked. Allow it in the browser's Site Permissions, then reconnect.";
  } else if (
    normalized.includes("webrtc") ||
    normalized.includes("sdp") ||
    normalized.includes("peer connection") ||
    normalized.includes("connection closed") ||
    normalized.includes("network")
  ) {
    message = "The browser could not complete the WebRTC connection. Check microphone permission and try Chrome or Edge.";
  } else if (
    normalized.includes("401") ||
    normalized.includes("403") ||
    normalized.includes("authentication") ||
    normalized.includes("invalid ephemeral")
  ) {
    message = "The temporary OpenAI session was rejected. Restart the conversation to request a new session.";
  } else if (
    normalized.includes("429") ||
    normalized.includes("quota") ||
    normalized.includes("rate limit")
  ) {
    message = "OpenAI is temporarily rate-limited. Wait a moment, then reconnect.";
  } else if (normalized.includes("invalid") || normalized.includes("unsupported")) {
    message = "OpenAI rejected a Realtime session setting.";
  }

  return debug && detail ? `${message} Technical detail: ${detail}` : message;
}
