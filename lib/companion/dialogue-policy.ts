import {
  type ProsodySignal,
  type VocalArousal,
  vocalTempo,
  type VocalTempo,
} from "@/lib/companion/prosody";
import type { SafetyAssessment } from "@/lib/companion/safety";
import { indianPartOfDay, openerForTime, openerIsMeal } from "@/lib/companion/time-of-day";
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

/**
 * How much the person actually offered this turn. Drives reply length: the
 * fastest way to sound like a machine is to answer "हाँ" with a paragraph.
 */
export type ConversationalEnergy = "minimal" | "brief" | "engaged";

/**
 * How the turn *sounded*, as opposed to how much of it there was. Words tell
 * you the size of a turn; they cannot tell you that those words came out slowly,
 * with long gaps, in a voice that has gone flat.
 */
export type VocalRegister = "heavy" | "even" | "lively";

export type TurnPlan = {
  objective: ResponseObjective;
  mayAskQuestion: boolean;
  avoidSuggestions: string[];
  partOfDay: "morning" | "afternoon" | "evening" | "night";
  energy: ConversationalEnergy;
  register: VocalRegister;
  tempo: VocalTempo;
  /**
   * Multiplier on the configured TTS pace. Speaking back at a brisk clip to
   * someone whose own voice has slowed is a mismatch the listener hears even
   * when the words are right.
   */
  paceScale: number;
  maxSentences: number;
  directive: string;
};

/**
 * Word count is a crude proxy, but it is deterministic and it is the signal
 * that matters most: a one-word turn should never receive a paragraph. Counts
 * words rather than characters so Devanagari and Latin script are treated the
 * same.
 */
export function conversationalEnergy(transcript: string): ConversationalEnergy {
  const words = transcript.trim().split(/\s+/).filter(Boolean).length;
  if (words <= 3) return "minimal";
  if (words <= 15) return "brief";
  return "engaged";
}

/**
 * Fold how the turn sounded into how it is answered.
 *
 * Atmaja & Akagi (arXiv:2003.01277) found that the proportion of silence in an
 * utterance predicts *arousal* specifically -- adding it lifted arousal CCC by
 * 17% relative while valence and dominance were largely unmoved -- and
 * Gosztolya & Toth (arXiv:2008.03183) found speech tempo carries elderly
 * emotion. Neither says anything about valence, so neither is treated here as
 * evidence about mood: a flat, slow, pause-heavy turn is read only as low
 * arousal, never as "this person is sad".
 *
 * That distinction is what keeps this safe. Low arousal makes Saathi quieter and
 * slower; it never makes Saathi decide something is wrong, and it never
 * triggers concern, which stays entirely the safety layer's job.
 */
export function vocalRegister(prosody: ProsodySignal | undefined, tempo: VocalTempo): VocalRegister {
  if (!prosody) return "even";
  if (prosody.arousal === "low" || tempo === "slow") return "heavy";
  if (prosody.arousal === "high" && tempo === "quick") return "lively";
  return "even";
}

/**
 * Reply size starts from the word count and is only ever *reduced* by how the
 * turn sounded, never increased.
 *
 * "मैं… ठीक… हूँ…" is five words spread thin over fifteen seconds. Counted as
 * text it earns a couple of sentences back; heard, it is barely more than a
 * minimal turn, and two composed sentences in reply would overshoot it badly.
 *
 * Deliberately keyed on arousal alone rather than on the whole register. The
 * silence-fraction result is the one with a published effect size behind it
 * (Atmaja & Akagi, +17% relative arousal CCC); tempo is a softer signal, and a
 * merely unhurried speaker who is otherwise fluent should not have their reply
 * cut to a fragment for it. Tempo still shapes tone and pace, just not length.
 *
 * A long turn is left alone even when it comes out slowly. Someone who has just
 * told you a great deal, haltingly, has still told you a great deal -- cutting
 * the reply to a fragment would read as not having listened.
 */
export function fuseEnergy(
  textEnergy: ConversationalEnergy,
  arousal: VocalArousal | undefined,
): ConversationalEnergy {
  if (arousal === "low" && textEnergy === "brief") return "minimal";
  return textEnergy;
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
  /** Level-trace summary for this turn's audio, when the client supplied one. */
  prosody?: ProsodySignal;
}): TurnPlan {
  const objective = chooseObjective(input.transcript, input.safety, input.meta);
  const partOfDay = indianPartOfDay(input.now ?? new Date());
  const safetyQuestion = objective === "SAFETY_CHECK" || objective === "MEDICATION_UNCERTAINTY";
  const quiet = objective === "QUIET_COMPANIONSHIP";
  const recentQuestions = Math.max(
    recentQuestionCount(input.history),
    input.meta.recentQuestionTurns.filter(Boolean).length,
  );
  const textEnergy = conversationalEnergy(input.transcript);
  const wordCount = input.transcript.trim().split(/\s+/).filter(Boolean).length;
  const tempo = vocalTempo(wordCount, input.prosody?.spokenMs ?? 0);
  const register = vocalRegister(input.prosody, tempo);
  // Safety and repair objectives read the words alone -- how calmly or slowly
  // someone can get out "I fell and I can't get up" must never soften the
  // response to it.
  const energy = safetyQuestion || objective === "REPAIR"
    ? textEnergy
    : fuseEnergy(textEnergy, input.prosody?.arousal);
  // A minimal turn ("हाँ", "अच्छा") should not draw a question on top of an
  // already-oversized reply -- unless safety genuinely requires one.
  const mayAskQuestion =
    !quiet && (safetyQuestion || (recentQuestions < 2 && energy !== "minimal"));
  const avoidSuggestions = recentSuggestions(input.history);
  // Safety turns get room to ask one clear question; otherwise reply length
  // tracks what the person actually offered.
  const maxSentences = safetyQuestion
    ? 3
    : energy === "minimal"
      ? 1
      : energy === "brief"
        ? 2
        : 4;
  // Mirrors back to the elder's own pace rather than a fixed TTS speed: a
  // heavy, slow turn is met with a slightly slower reply; a lively, quick one
  // does not need to be dragged out. Kept close to 1.0 -- this nudges, it does
  // not perform.
  const paceScale = register === "heavy" ? 0.92 : register === "lively" ? 1.04 : 1;

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

  const energyRule = {
    minimal:
      "They gave you almost nothing this turn -- a word or two. Reply with a fragment or a few words at most (\"हूँ…\", \"हाँ… ठीक है।\"). Do not praise, do not expand, do not fill the silence with a paragraph.",
    brief:
      "They offered one short thought. Answer at the same size: one short sentence. Do not inflate it.",
    engaged:
      "They actually opened up. You may take up to four sentences, and should respond to the specific details they cared about rather than summarising.",
  }[energy];
  // Only surfaced for a non-safety, non-repair turn -- see the `energy`
  // assignment above for why those two objectives skip register entirely.
  const registerRule = !safetyQuestion && objective !== "REPAIR" && register === "heavy"
    ? "Their voice came out slow and effortful, with long pauses. Answer gently and unhurried; do not match their pace with a brisk or upbeat reply."
    : null;

  return {
    objective,
    mayAskQuestion,
    avoidSuggestions,
    partOfDay,
    energy,
    register,
    tempo,
    paceScale,
    maxSentences,
    directive: [
      `Response objective: ${objective}.`,
      objectiveRules[objective],
      `Conversational energy: ${energy}. ${energyRule}`,
      ...(registerRule ? [registerRule] : []),
      `Hard limit: at most ${maxSentences} sentence(s).`,
      "Do not praise ordinary daily activities. Watering plants or having tea is not an achievement.",
      questionRule,
      suggestionRule,
      `Local time context: ${partOfDay} in India. Do not run a routine checklist because of the time alone.`,
      // Only offered as a fallback opener. The objective rules above still
      // govern the turn -- this must never override SAFETY_CHECK, an emotional
      // moment, or an explicit request to just sit quietly.
      openerIsMeal(input.now ?? new Date())
        ? `If the person has nothing to say and the silence feels stuck rather than restful, you may gently ask whether they have had ${openerForTime(input.now ?? new Date())} yet, then follow wherever they take it. Never ask this while a safety, emotional, or quiet-companionship objective is active.`
        : `It is late at night. Do not ask about meals. If the silence feels stuck, gently ask whether they are able to sleep, and encourage rest. Never ask this while a safety, emotional, or quiet-companionship objective is active.`,
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
  /** Language the person actually used this turn, if it was clear enough to
   *  tell. Undefined means "no signal", so the existing preference stands. */
  detectedLanguage?: string;
}): DialogueMeta {
  return {
    turnCount: input.previous.turnCount + 1,
    lastObjective: input.plan.objective,
    lastRiskLevel: input.safety.level,
    lastSafetyConcern: input.safety.concern,
    // Follows the person: a clear switch updates the preference and sticks,
    // rather than locking forever to whatever language the first turn used.
    preferredLanguage:
      input.detectedLanguage || input.previous.preferredLanguage || input.outputLanguage,
    recentQuestionTurns: [
      ...input.previous.recentQuestionTurns,
      input.reply.includes("?") || input.reply.includes("？"),
    ].slice(-2),
  };
}
