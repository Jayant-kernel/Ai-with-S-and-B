export type SafetyConcern =
  | "none"
  | "medication_uncertainty"
  | "fall"
  | "chest_pain"
  | "breathing"
  | "confusion"
  | "self_harm"
  | "abuse"
  | "stranded";

export type SafetyAssessment = {
  level: "none" | "concern" | "urgent";
  concern: SafetyConcern;
  cues: string[];
};

const rules: Array<{
  concern: Exclude<SafetyConcern, "none">;
  level: SafetyAssessment["level"];
  patterns: RegExp[];
}> = [
  {
    concern: "self_harm",
    level: "urgent",
    patterns: [
      /\b(kill|hurt) myself\b/i,
      /\bsuicid(?:e|al)\b/i,
      /\b(?:want|going) to die\b/i,
      /\bmarna chaht[ai]\b/i,
      /खुदकुशी|आत्महत्या|मरना चाहता|मरना चाहती/u,
    ],
  },
  {
    concern: "breathing",
    level: "urgent",
    patterns: [
      /\b(?:cannot|can't|unable to) breathe\b/i,
      /\bsevere (?:shortness of breath|breathing difficulty)\b/i,
      /सांस नहीं|साँस नहीं|सांस लेने में बहुत/u,
    ],
  },
  {
    concern: "chest_pain",
    level: "urgent",
    patterns: [
      /\bsevere chest pain\b/i,
      /\bchest pain\b.*\b(?:sweat|dizzy|breath|crush)/i,
      /सीने में तेज दर्द|छाती में तेज दर्द/u,
    ],
  },
  {
    concern: "fall",
    level: "urgent",
    patterns: [
      /\b(?:fell|fallen|had a fall)\b.*\b(?:can't|cannot|unable|bleeding|head|injur)/i,
      /\bcan't (?:stand up|get up)\b/i,
      /गिर[^।.!?]{0,60}(?:उठ नहीं|चोट)/u,
    ],
  },
  {
    concern: "confusion",
    level: "urgent",
    patterns: [
      /\b(?:suddenly confused|don't know where i am|cannot remember where i am)\b/i,
      /पता नहीं मैं कहाँ|अचानक उलझन/u,
    ],
  },
  {
    concern: "abuse",
    level: "urgent",
    patterns: [
      /\b(?:he|she|they|someone|caregiver|son|daughter)\s+(?:hit|hurt|threaten(?:ed|s)?) me\b/i,
      /\blocked me (?:in|out)\b/i,
      /\bnot safe at home\b/i,
      /मुझे मार|घर में सुरक्षित नहीं|बंद कर दिया/u,
    ],
  },
  {
    concern: "stranded",
    level: "concern",
    patterns: [
      /\b(?:locked out|stranded|lost and alone)\b/i,
      /घर से बाहर बंद|रास्ता भूल/u,
    ],
  },
  {
    concern: "fall",
    level: "concern",
    patterns: [
      /\b(?:fell|fallen|had a fall|might fall|afraid .* fall)\b/i,
      /गिर गया|गिर गई|गिरने का डर/u,
    ],
  },
  {
    concern: "chest_pain",
    level: "concern",
    patterns: [/\bchest pain\b/i, /सीने में दर्द|छाती में दर्द/u],
  },
];

const medicationWords = /\b(?:medicine|medication|tablet|pill|dose|dawai)\b|दवा|गोली/u;
const medicationUncertainty = /\b(?:which|what|how much|did i|have i|already|should i take|name|don't remember|do not remember|forget|forgot|not sure|whether)\b|कौन सी|कितनी|खाई थी|ले ली|नाम|याद नहीं|पक्का नहीं/u;

export function classifySafety(transcript: string): SafetyAssessment {
  const text = transcript.trim();
  for (const rule of rules) {
    const cues = rule.patterns.filter((pattern) => pattern.test(text)).map(String);
    if (cues.length > 0) return { level: rule.level, concern: rule.concern, cues };
  }
  if (medicationWords.test(text) && medicationUncertainty.test(text)) {
    return {
      level: "concern",
      concern: "medication_uncertainty",
      cues: ["explicit medication uncertainty"],
    };
  }
  return { level: "none", concern: "none", cues: [] };
}
