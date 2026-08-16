export type PiiKind = "aadhaar" | "card" | "otp" | "phone" | "upi";

export type PiiRedaction = {
  kind: PiiKind;
  placeholder: string;
};

const patterns: Array<{ kind: PiiKind; pattern: RegExp }> = [
  { kind: "aadhaar", pattern: /\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/g },
  { kind: "card", pattern: /\b(?:\d[ -]?){13,19}\b/g },
  { kind: "otp", pattern: /\b(?:otp|one[ -]?time password|code)\D{0,12}\d{4,8}\b/gi },
  { kind: "phone", pattern: /(?:\+91[ -]?)?[6-9]\d{9}\b/g },
  { kind: "upi", pattern: /\b[a-z0-9._-]{2,}@[a-z][a-z0-9.-]{1,}\b/gi },
];

export function redactPii(text: string) {
  const redactions: PiiRedaction[] = [];
  let redacted = text;

  for (const { kind, pattern } of patterns) {
    redacted = redacted.replace(pattern, () => {
      const placeholder = `[${kind.toUpperCase()}_REDACTED]`;
      redactions.push({ kind, placeholder });
      return placeholder;
    });
  }

  return { redacted, redactions };
}
