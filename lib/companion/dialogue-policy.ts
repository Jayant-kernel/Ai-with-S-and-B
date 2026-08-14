import type { SafetyAssessment } from "@/lib/companion/safety";
import type { ConversationMessage, DialogueMeta } from "@/lib/sarvam/settings";

export type ResponseObjective =
  | "LISTEN"
  | "ACKNOWLEDGE"
  | "EXPLORE_EMOTION"
  | "CONTINUE_TOPIC"
  | "GENTLY_SUGGEST"
  | "ROUTINE_CHECK"
  | "MEMORY_FOLLOWUP"
  | "SAFETY_CHECK"
  | "MEDICATION_UNCERTAINTY"
  | "QUIET_COMPANIONSHIP"
  | "REPAIR";

export type TurnPlan = {
  objective: ResponseObjective;
  mayAskQuestion: boolean;
  avoidSuggestions: string[];
  partOfDay: "morning" | "afternoon" | "evening" | "night";
  directive: string;
};

function indianPartOfDay(now: Date) {
  const hour = Number(new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(now));
  if (hour >= 5 && hour < 12) return "morning" as const;
  if (hour >= 12 && hour < 17) return "afternoon" as const;
  if (hour >= 17 && hour < 22) return "evening" as const;
  return "night" as const;
}

function includesAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function chooseObjective(
  transcript: string,
  safety: SafetyAssessment,
  meta: DialogueMeta,
): ResponseObjective {
  if (safety.concern === "medication_uncertainty") return "MEDICATION_UNCERTAINTY";
  if (safety.level !== "none") return "SAFETY_CHECK";
  const safetyResolved = includesAny(transcript, [
    /\b(?:i am|i'm) (?:okay|fine) now\b/i,
    /\b(?:pain is gone|can stand now|false alarm)\b/i,
    /अब ठीक|मैं ठीक हूँ|मैं ठीक हूं/u,
  ]);
  if (!safetyResolved && meta.lastRiskLevel !== "none") {
    if (meta.lastSafetyConcern === "medication_uncertainty") return "MEDICATION_UNCERTAINTY";
    if (meta.lastObjective === "SAFETY_CHECK") return "SAFETY_CHECK";
  }
  if (includesAny(transcript, [
    /\b(?:stay with me|just sit with me|just listen|no advice|don't ask)\b/i,
    /बस मेरे साथ|बस सुनो|चुपचाप साथ/u,
  ])) return "QUIET_COMPANIONSHIP";
  if (includesAny(transcript, [
    /\b(?:lonely|alone|sad|grief|miss(?:ing)?|anxious|worried|upset)\b/i,
    /अकेला|अकेली|उदास|याद आ|चिंता|घबराहट/u,
  ])) return "EXPLORE_EMOTION";
  if (includesAny(transcript, [
    /\b(?:no[, ]+i said|that's not what i said|you misheard|say that again|repeat that)\b/i,
    /नहीं.*मैंने कहा|फिर से कहो|गलत सुना/u,
  ])) return "REPAIR";
  if (includesAny(transcript, [/\b(?:yes|haan|hmm|okay|achha|right)\b/i, /^(?:हाँ|हां|अच्छा|ठीक)[।.!]?$/u])) {
    return "CONTINUE_TOPIC";
  }
  return "ACKNOWLEDGE";
}

function recentQuestionCount(history: ConversationMessage[]) {
  return history
    .filter(({ role }) => role === "assistant")
    .slice(-2)
    .filter(({ content }) => content.includes("?") || content.includes("？"))
    .length;
}

function recentSuggestions(history: ConversationMessage[]) {
  const assistantText = history
    .filter(({ role }) => role === "assistant")
    .slice(-5)
    .map(({ content }) => content)
    .join(" ");
  const suggestions = [
    ["call family", /\bcall\b.*\b(?:family|son|daughter|friend)\b/i],
    ["drink water", /\b(?:drink|have)\b.*\bwater\b/i],
    ["sit or rest", /\b(?:sit|rest|lie down)\b/i],
    ["take a walk", /\b(?:walk|stroll)\b/i],
    ["listen to music", /\b(?:music|song)\b/i],
  ] as const;
  return suggestions.filter(([, pattern]) => pattern.test(assistantText)).map(([label]) => label);
}

export function planDialogue(input: {
  transcript: string;
  history: ConversationMessage[];
  meta: DialogueMeta;
  safety: SafetyAssessment;
  now?: Date;
}): TurnPlan {
  const objective = chooseObjective(input.transcript, input.safety, input.meta);
  const partOfDay = indianPartOfDay(input.now ?? new Date());
  const safetyQuestion = objective === "SAFETY_CHECK" || objective === "MEDICATION_UNCERTAINTY";
  const quiet = objective === "QUIET_COMPANIONSHIP";
  const recentQuestions = Math.max(
    recentQuestionCount(input.history),
    input.meta.recentQuestionTurns.filter(Boolean).length,
  );
  const mayAskQuestion = !quiet && (safetyQuestion || recentQuestions < 2);
  const avoidSuggestions = recentSuggestions(input.history);

  const objectiveRules: Record<ResponseObjective, string> = {
    LISTEN: "Make space for the person to continue. Do not advise or ask a question.",
    ACKNOWLEDGE: "Respond to the exact content first. Advice is optional, not automatic.",
    EXPLORE_EMOTION: "Acknowledge the emotion before logistics. Explore gently; do not rush to solve it.",
    CONTINUE_TOPIC: "Continue the existing topic without introducing a routine or checklist item.",
    GENTLY_SUGGEST: "Offer at most one low-pressure suggestion after acknowledging the person.",
    ROUTINE_CHECK: "Mention only one relevant routine item and keep it inside natural conversation.",
    MEMORY_FOLLOWUP: "Use only a fact present verbatim in the supplied conversation. Express uncertainty if needed.",
    SAFETY_CHECK: "Move calmly into safety mode. Ask one short severity or immediate-safety question and encourage nearby human help when appropriate. Do not diagnose.",
    MEDICATION_UNCERTAINTY: "Warmly say you do not want to guess and cannot verify the medicine, dose, or whether it was taken. Suggest checking an approved reminder, medicine box, caregiver, or family member. Never provide an inferred answer.",
    QUIET_COMPANIONSHIP: "Confirm your presence once, then allow silence. Do not ask a question or propose an activity.",
    REPAIR: "Accept the correction briefly, repeat only the corrected detail, or ask for the missing fragment. Do not defend the earlier answer.",
  };

  const questionRule = mayAskQuestion
    ? "You may ask at most one main question, but a question is not required."
    : "Do not ask a question in this response.";
  const suggestionRule = avoidSuggestions.length > 0
    ? `Do not repeat these recent suggestions unless the situation materially changed: ${avoidSuggestions.join(", ")}.`
    : "Do not introduce a suggestion unless it genuinely helps this turn.";

  return {
    objective,
    mayAskQuestion,
    avoidSuggestions,
    partOfDay,
    directive: [
      `Response objective: ${objective}.`,
      objectiveRules[objective],
      questionRule,
      suggestionRule,
      `Local time context: ${partOfDay} in India. Do not run a routine checklist because of the time alone.`,
      `This is turn ${input.meta.turnCount + 1}. Keep the spoken reply short, natural, and easy to follow.`,
    ].join("\n"),
  };
}

export function updateDialogueMeta(input: {
  previous: DialogueMeta;
  reply: string;
  plan: TurnPlan;
  safety: SafetyAssessment;
  outputLanguage: string;
}): DialogueMeta {
  return {
    turnCount: input.previous.turnCount + 1,
    lastObjective: input.plan.objective,
    lastRiskLevel: input.safety.level,
    lastSafetyConcern: input.safety.concern,
    preferredLanguage: input.previous.preferredLanguage || input.outputLanguage,
    recentQuestionTurns: [
      ...input.previous.recentQuestionTurns,
      input.reply.includes("?") || input.reply.includes("？"),
    ].slice(-2),
  };
}
