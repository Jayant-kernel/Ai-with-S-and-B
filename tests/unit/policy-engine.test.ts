import { describe, expect, it } from "vitest";

import { decideResponsePolicy } from "../../lib/companion/policy-engine";
import type { ModelSafetyAssessment } from "../../lib/companion/safety-observer";

const normal: ModelSafetyAssessment = {
  category: "none",
  severity: "none",
  action: "allow",
  confidence: 0.99,
  source: "model",
};

describe("deterministic response policy", () => {
  it("allows a response only when both model checks approve it", () => {
    expect(decideResponsePolicy({
      deterministic: { level: "none", concern: "none", cues: [] },
      inputSafety: normal,
      outputSafety: normal,
      candidateReply: "Tell me more about your day.",
    })).toEqual({
      action: "allow",
      reason: "approved",
      reply: "Tell me more about your day.",
    });
  });

  it("replaces credential requests with fixed safe speech", () => {
    const credential: ModelSafetyAssessment = {
      category: "credential_request",
      severity: "urgent",
      action: "block",
      confidence: 0.98,
      source: "model",
    };
    const result = decideResponsePolicy({
      deterministic: { level: "none", concern: "none", cues: [] },
      inputSafety: credential,
      outputSafety: normal,
      candidateReply: "Unsafe draft",
    });

    expect(result.action).toBe("replace");
    expect(result.reply).toContain("OTP");
    expect(result.reply).not.toContain("Unsafe draft");
  });

  it("enforces deterministic scam detection when model safety is disabled", () => {
    const disabled: ModelSafetyAssessment = {
      category: "none",
      severity: "none",
      action: "allow",
      confidence: 1,
      source: "disabled",
    };
    const result = decideResponsePolicy({
      deterministic: { level: "urgent", concern: "scam", cues: ["money request"] },
      inputSafety: disabled,
      outputSafety: disabled,
      candidateReply: "Unsafe draft",
    });

    expect(result.reason).toBe("scam");
    expect(result.reply).toContain("do not send money");
  });

  it("fails closed when either independent safety check is unavailable", () => {
    const unavailable: ModelSafetyAssessment = {
      category: "none",
      severity: "none",
      action: "clarify",
      confidence: 0,
      source: "model_error",
    };
    const result = decideResponsePolicy({
      deterministic: { level: "none", concern: "none", cues: [] },
      inputSafety: unavailable,
      outputSafety: normal,
      candidateReply: "This draft must not be spoken.",
    });

    expect(result.action).toBe("replace");
    expect(result.reason).toBe("safety_unavailable");
    expect(result.reply).not.toContain("draft");
  });

  it("keeps deterministic crisis handling ahead of a model outage", () => {
    const unavailable: ModelSafetyAssessment = {
      category: "none",
      severity: "none",
      action: "clarify",
      confidence: 0,
      source: "model_error",
    };
    const result = decideResponsePolicy({
      deterministic: { level: "urgent", concern: "self_harm", cues: ["crisis"] },
      inputSafety: unavailable,
      outputSafety: unavailable,
      candidateReply: "Unsafe draft",
    });

    expect(result.reason).toBe("urgent");
    expect(result.reply).toContain("immediate human help");
  });

  it("does not ignore a blocked input category", () => {
    const blocked: ModelSafetyAssessment = {
      category: "privacy",
      severity: "concern",
      action: "block",
      confidence: 0.9,
      source: "model",
    };
    const result = decideResponsePolicy({
      deterministic: { level: "none", concern: "none", cues: [] },
      inputSafety: blocked,
      outputSafety: normal,
      candidateReply: "Unsafe draft",
    });

    expect(result.reason).toBe("unsafe_input");
    expect(result.reply).not.toContain("draft");
  });

  it("uses Hindi scripted safety speech for a Hindi turn", () => {
    const result = decideResponsePolicy({
      deterministic: { level: "urgent", concern: "scam", cues: ["payment"] },
      inputSafety: normal,
      outputSafety: normal,
      candidateReply: "Unsafe draft",
      languageCode: "hi-IN",
    });

    expect(result.reason).toBe("scam");
    expect(result.reply).toContain("धोखाधड़ी");
  });

  it("replaces the candidate when output safety says clarify, not just block/escalate", () => {
    // Regression: only outputSafety.action in ["block","escalate"] used to
    // be checked, so a "clarify" verdict on the *output* fell all the way
    // through to the unvetted candidate reply.
    const uncertainOutput: ModelSafetyAssessment = {
      category: "unsafe_advice",
      severity: "concern",
      action: "clarify",
      confidence: 0.6,
      source: "model",
    };
    const result = decideResponsePolicy({
      deterministic: { level: "none", concern: "none", cues: [] },
      inputSafety: normal,
      outputSafety: uncertainOutput,
      candidateReply: "This unvetted draft must never be spoken.",
    });

    expect(result.action).toBe("replace");
    expect(result.reason).toBe("clarify");
    expect(result.reply).not.toContain("unvetted draft");
  });

  it("still allows the candidate when output safety explicitly allows it", () => {
    const result = decideResponsePolicy({
      deterministic: { level: "none", concern: "none", cues: [] },
      inputSafety: normal,
      outputSafety: normal,
      candidateReply: "Tell me more about your day.",
    });

    expect(result).toEqual({
      action: "allow",
      reason: "approved",
      reply: "Tell me more about your day.",
    });
  });
});
