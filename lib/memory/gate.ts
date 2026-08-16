import { redactPii } from "@/lib/privacy/pii";

export type MemoryDisposition = "store" | "pending" | "discard";
export type MemoryCategory = "preference" | "relationship" | "future_event" | "health" | "financial" | "secret" | "unknown";

export type MemoryCandidate = {
  text: string;
  category: MemoryCategory;
  confidence: number;
  userConfirmed: boolean;
};

export function gateMemory(candidate: MemoryCandidate): {
  disposition: MemoryDisposition;
  sanitizedText?: string;
  reason: string;
} {
  const pii = redactPii(candidate.text);
  if (
    pii.redactions.length > 0 ||
    candidate.category === "financial" ||
    candidate.category === "secret"
  ) {
    return { disposition: "discard", reason: "sensitive_or_identifying" };
  }
  if (candidate.category === "health" || !candidate.userConfirmed || candidate.confidence < 0.85) {
    return {
      disposition: "pending",
      sanitizedText: pii.redacted,
      reason: "requires_confirmation",
    };
  }
  return { disposition: "store", sanitizedText: pii.redacted, reason: "approved" };
}
