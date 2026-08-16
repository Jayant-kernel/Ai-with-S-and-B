import { describe, expect, it } from "vitest";

import { observeSafety } from "../../lib/companion/safety-observer";
import { parseServerEnv } from "../../lib/config/env-schema";

const env = parseServerEnv({
  SARVAM_API_KEY: "sarvam-test",
  GROQ_API_KEY: "groq-test",
  ENABLE_SAFETY_MONITOR: "true",
});

describe("model safety observer", () => {
  it("accepts the exact safety contract", async () => {
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            category: "none",
            severity: "none",
            action: "allow",
            confidence: 0.99,
          }),
        },
        finish_reason: "stop",
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });

    await expect(observeSafety({
      phase: "input",
      text: "Today was a good day.",
      env,
      fetchImpl,
    })).resolves.toMatchObject({ source: "model", action: "allow" });
  });

  it("fails closed when the model invents labels outside the contract", async () => {
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            category: "positive",
            severity: "low",
            action: "none",
            confidence: "high",
          }),
        },
        finish_reason: "stop",
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });

    await expect(observeSafety({
      phase: "input",
      text: "Today was a good day.",
      env,
      fetchImpl,
    })).resolves.toMatchObject({ source: "model_error", action: "clarify" });
  });

  it("fails closed when an explicit safety provider has no key configured", async () => {
    const misconfigured = parseServerEnv({
      SARVAM_API_KEY: "sarvam-test",
      SAFETY_PROVIDER: "groq",
      ENABLE_SAFETY_MONITOR: "true",
      // GROQ_API_KEY intentionally omitted: this must not be silently
      // treated as "no independent provider available" (which is allowed
      // and returns DISABLED/allow); an explicit request that cannot be
      // honored is a misconfiguration and must fail closed instead.
    });

    await expect(observeSafety({
      phase: "input",
      text: "Today was a good day.",
      env: misconfigured,
    })).resolves.toMatchObject({ source: "model_error", action: "clarify" });
  });

  it("stays disabled, not an error, when auto mode finds no provider configured", async () => {
    const noProviders = parseServerEnv({
      SARVAM_API_KEY: "sarvam-test",
      ENABLE_SAFETY_MONITOR: "true",
      // SAFETY_PROVIDER defaults to "auto"; no GROQ_API_KEY/OPENAI_API_KEY.
    });

    await expect(observeSafety({
      phase: "input",
      text: "Today was a good day.",
      env: noProviders,
    })).resolves.toMatchObject({ source: "disabled", action: "allow" });
  });
});
