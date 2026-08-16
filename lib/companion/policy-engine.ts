import type { SafetyAssessment } from "@/lib/companion/safety";
import type { ModelSafetyAssessment } from "@/lib/companion/safety-observer";

export type PolicyDecision = {
  action: "allow" | "replace";
  reason: string;
  reply: string;
};

const englishReplies = {
  credential_request:
    "Please do not share any OTP, PIN, password, card number, or bank detail. I cannot help transfer money or verify a financial request.",
  scam:
    "This may be a scam. Please do not send money or share banking details. Contact your bank or a trusted person using a number you already know.",
  urgent:
    "This may need immediate human help. Please contact someone nearby or your local emergency service now. I can stay with you while you do that.",
  unsafe_output:
    "I do not want to guess or give you unsafe information. Please check with a trusted person or qualified professional.",
  safety_unavailable:
    "I am having trouble checking that safely right now. Please try again in a moment, or contact a trusted person if this is urgent.",
  uncertain:
    "I may not have understood that safely. Could you please say it once more without sharing any private number or password?",
} as const;

const hindiReplies: Record<keyof typeof englishReplies, string> = {
  credential_request:
    "कृपया कोई ओटीपी, पिन, पासवर्ड, कार्ड नंबर या बैंक की जानकारी साझा न करें। मैं पैसे भेजने या किसी वित्तीय अनुरोध की पुष्टि करने में मदद नहीं कर सकता।",
  scam:
    "यह धोखाधड़ी हो सकती है। कृपया पैसे न भेजें और बैंक की जानकारी साझा न करें। अपने बैंक या किसी भरोसेमंद व्यक्ति से उस नंबर पर संपर्क करें जिसे आप पहले से जानते हैं।",
  urgent:
    "इस स्थिति में तुरंत किसी इंसान की मदद की जरूरत हो सकती है। अभी पास के किसी व्यक्ति या स्थानीय आपातकालीन सेवा से संपर्क करें। जब तक आप ऐसा करते हैं, मैं आपके साथ हूँ।",
  unsafe_output:
    "मैं अनुमान लगाकर असुरक्षित जानकारी नहीं देना चाहता। कृपया किसी भरोसेमंद व्यक्ति या योग्य विशेषज्ञ से पुष्टि करें।",
  safety_unavailable:
    "अभी मैं इस बात की सुरक्षित जाँच नहीं कर पा रहा हूँ। कृपया थोड़ी देर में फिर कोशिश करें, और यदि स्थिति जरूरी है तो किसी भरोसेमंद व्यक्ति से तुरंत संपर्क करें।",
  uncertain:
    "शायद मैं आपकी बात सुरक्षित तरीके से नहीं समझ पाया। कृपया कोई निजी नंबर या पासवर्ड बताए बिना एक बार फिर कहें।",
};

function scriptedReplies(languageCode: string | undefined) {
  return languageCode?.toLowerCase().startsWith("hi") ? hindiReplies : englishReplies;
}

export function decideResponsePolicy(input: {
  deterministic: SafetyAssessment;
  inputSafety: ModelSafetyAssessment;
  outputSafety: ModelSafetyAssessment;
  candidateReply: string;
  languageCode?: string;
}): PolicyDecision {
  const replies = scriptedReplies(input.languageCode);
  if (input.deterministic.concern === "credential_request") {
    return { action: "replace", reason: "credential_request", reply: replies.credential_request };
  }
  if (input.deterministic.concern === "scam") {
    return { action: "replace", reason: "scam", reply: replies.scam };
  }
  if (input.deterministic.level === "urgent") {
    return { action: "replace", reason: "urgent", reply: replies.urgent };
  }
  if (
    input.inputSafety.source === "model_error" ||
    input.outputSafety.source === "model_error"
  ) {
    return {
      action: "replace",
      reason: "safety_unavailable",
      reply: replies.safety_unavailable,
    };
  }
  if (
    input.inputSafety.category === "credential_request"
  ) {
    return { action: "replace", reason: "credential_request", reply: replies.credential_request };
  }
  if (
    input.inputSafety.category === "scam"
  ) {
    return { action: "replace", reason: "scam", reply: replies.scam };
  }
  if (
    input.inputSafety.action === "escalate"
  ) {
    return { action: "replace", reason: "urgent", reply: replies.urgent };
  }
  if (input.inputSafety.action === "block") {
    return { action: "replace", reason: "unsafe_input", reply: replies.unsafe_output };
  }
  if (["block", "escalate"].includes(input.outputSafety.action)) {
    return { action: "replace", reason: "unsafe_output", reply: replies.unsafe_output };
  }
  if (
    input.inputSafety.action === "clarify"
  ) {
    return { action: "replace", reason: "clarify", reply: replies.uncertain };
  }
  return { action: "allow", reason: "approved", reply: input.candidateReply };
}
