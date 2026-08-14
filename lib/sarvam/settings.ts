export const SARVAM_TTS_LANGUAGES = [
  "bn-IN",
  "en-IN",
  "gu-IN",
  "hi-IN",
  "kn-IN",
  "ml-IN",
  "mr-IN",
  "od-IN",
  "pa-IN",
  "ta-IN",
  "te-IN",
] as const;

export const SARVAM_VOICES = ["ritu", "priya", "simran", "shubh"] as const;
export type SarvamVoice = (typeof SARVAM_VOICES)[number];

export type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

export type DialogueMeta = {
  turnCount: number;
  recentQuestionTurns: boolean[];
  lastObjective: string;
  lastRiskLevel: "none" | "concern" | "urgent";
  lastSafetyConcern: string;
  preferredLanguage: string;
};

export type ConversationContext = {
  messages: ConversationMessage[];
  meta: DialogueMeta;
};

export const EMPTY_DIALOGUE_META: DialogueMeta = {
  turnCount: 0,
  recentQuestionTurns: [],
  lastObjective: "LISTEN",
  lastRiskLevel: "none",
  lastSafetyConcern: "none",
  preferredLanguage: "",
};

export function emptyConversationContext(): ConversationContext {
  return { messages: [], meta: { ...EMPTY_DIALOGUE_META } };
}
