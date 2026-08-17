export type PartOfDay = "morning" | "afternoon" | "evening" | "night";

/**
 * Part of day in India, regardless of where the server runs. Shared by the
 * Sarvam turn path (via dialogue-policy) and the Realtime session path (via
 * client-secret), so both companions agree on what time it is for the elder.
 */
export function indianPartOfDay(now: Date = new Date()): PartOfDay {
  const hour = Number(new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(now));
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

function indianHour(now: Date): number {
  return Number(new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(now));
}

const GREETING_BY_PART: Record<PartOfDay, string> = {
  morning: "सुप्रभात",
  afternoon: "नमस्ते",
  evening: "नमस्ते",
  night: "नमस्ते",
};

/**
 * A gentle everyday opener for when the person has nothing to say -- never a
 * checklist item. Deliberately finer-grained than PartOfDay: the "evening"
 * band runs 17:00-22:00, so keying the meal off it would ask about evening tea
 * at 9pm, when dinner is the natural question. Late at night no meal fits at
 * all, so it asks about rest instead of inventing one.
 */
export function openerForTime(now: Date = new Date()): string {
  const hour = indianHour(now);
  if (hour >= 5 && hour < 11) return "नाश्ता";
  if (hour >= 11 && hour < 16) return "दोपहर का खाना";
  if (hour >= 16 && hour < 19) return "शाम की चाय";
  if (hour >= 19 && hour < 23) return "रात का खाना";
  return "आराम"; // 23:00-05:00 -- ask about rest/sleep, not a meal
}

/** True when `openerForTime` returned a meal rather than rest. */
export function openerIsMeal(now: Date = new Date()): boolean {
  const hour = indianHour(now);
  return hour >= 5 && hour < 23;
}

export function greetingForPartOfDay(part: PartOfDay): string {
  return GREETING_BY_PART[part];
}

/**
 * A short Hindi time-context block appended to the companion instructions so
 * the model knows, without being told by the person, whether it is morning,
 * afternoon, evening, or night in India -- and which meal to gently ask about
 * if the conversation goes quiet.
 */
export function timeContextInstruction(now: Date = new Date()): string {
  const part = indianPartOfDay(now);
  const opener = openerForTime(now);
  const clock = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(now);

  const openerLine = openerIsMeal(now)
    ? `अगर बातचीत में चुप्पी आ जाए या उनके पास कहने को कुछ न हो, तो हल्के से पूछ सकते हैं कि ${opener} हुआ या नहीं, और वहीं से बात आगे बढ़ाएँ।`
    : `अभी देर रात है। अगर चुप्पी आ जाए तो खाने के बारे में मत पूछिए — बल्कि हल्के से पूछिए कि नींद आ रही है या नहीं, और आराम करने की सलाह दीजिए।`;

  return [
    `समय की जानकारी: अभी भारत में ${clock} बजे हैं — ${part}।`,
    openerLine,
    `पहली बार बात शुरू करते समय "${GREETING_BY_PART[part]}" जैसा अभिवादन स्वाभाविक लगेगा।`,
    `समय के कारण कोई चेकलिस्ट मत चलाइए — यह सिर्फ़ बातचीत को स्वाभाविक बनाने के लिए है।`,
  ].join("\n");
}
