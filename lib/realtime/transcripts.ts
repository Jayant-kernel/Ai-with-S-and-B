import type { RealtimeItem } from "@openai/agents/realtime";

function textFromItem(item: RealtimeItem) {
  if (item.type !== "message") return "";

  return item.content
    .map((part) => {
      if (part.type === "input_text" || part.type === "output_text") return part.text;
      if (part.type === "input_audio" || part.type === "output_audio") {
        return part.transcript ?? "";
      }
      return "";
    })
    .join(" ")
    .trim();
}

export function latestTranscripts(history: RealtimeItem[]) {
  let user = "";
  let assistant = "";

  for (const item of history) {
    if (item.type !== "message") continue;
    const text = textFromItem(item);
    if (!text) continue;
    if (item.role === "user") user = text;
    if (item.role === "assistant") assistant = text;
  }

  return { user, assistant };
}
