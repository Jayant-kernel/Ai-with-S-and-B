import { describe, expect, it } from "vitest";

import { parseServerEnv } from "../../lib/config/env-schema";
import { extractMemoryCandidates } from "../../lib/memory/extractor";

const env = parseServerEnv({ GROQ_API_KEY: "groq-test" });

function fetchWithContent(content: string): typeof fetch {
  return async () => new Response(JSON.stringify({
    choices: [{ message: { content }, finish_reason: "stop" }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("memory candidate extraction request shape", () => {
  it("does not send reasoning_effort, which the conversation model rejects with a 400", async () => {
    // Regression, found live: this was copied from safety-observer.ts,
    // where reasoningEffort is valid because GROQ_SAFETY_MODEL is a
    // reasoning model. The extractor reuses GROQ_CONVERSATION_MODEL
    // (llama-3.3-70b-versatile), which returns HTTP 400 "`reasoning_effort`
    // is not supported with this model". Extraction fails soft, so that 400
    // was indistinguishable from "nothing worth remembering" -- memory
    // silently never recorded anything at all against a real Groq account.
    let sentBody: Record<string, unknown> | undefined;
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"candidates":[]}' }, finish_reason: "stop" }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    await extractMemoryCandidates({ transcript: "hello", reply: "hi", env, fetchImpl });

    expect(sentBody).toBeDefined();
    expect(sentBody).not.toHaveProperty("reasoning_effort");
    expect(sentBody).not.toHaveProperty("include_reasoning");
    expect(sentBody).toMatchObject({ response_format: { type: "json_object" }, temperature: 0 });
  });
});

describe("memory candidate extraction", () => {
  it("parses candidates that match the exact contract", async () => {
    const fetchImpl = fetchWithContent(JSON.stringify({
      candidates: [
        { text: "Enjoys listening to old Kishore Kumar songs", category: "preference", confidence: 0.92 },
      ],
    }));

    await expect(extractMemoryCandidates({
      transcript: "I love listening to Kishore Kumar songs in the evening.",
      reply: "That sounds lovely.",
      env,
      fetchImpl,
    })).resolves.toEqual([
      { text: "Enjoys listening to old Kishore Kumar songs", category: "preference", confidence: 0.92 },
    ]);
  });

  it("still surfaces financial/secret candidates instead of silently omitting them", async () => {
    const fetchImpl = fetchWithContent(JSON.stringify({
      candidates: [
        { text: "Son sends money for doctor visits", category: "financial", confidence: 0.8 },
      ],
    }));

    const candidates = await extractMemoryCandidates({
      transcript: "My son sent money again for the doctor.",
      reply: "I hope the visit went well.",
      env,
      fetchImpl,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.category).toBe("financial");
  });

  it("returns an empty array for a turn with nothing worth remembering", async () => {
    const fetchImpl = fetchWithContent(JSON.stringify({ candidates: [] }));

    await expect(extractMemoryCandidates({
      transcript: "Okay.",
      reply: "Alright, take care.",
      env,
      fetchImpl,
    })).resolves.toEqual([]);
  });

  it("fails soft (empty array) when the model returns malformed JSON", async () => {
    const fetchImpl = fetchWithContent("not json at all");

    await expect(extractMemoryCandidates({
      transcript: "Some turn.",
      reply: "Some reply.",
      env,
      fetchImpl,
    })).resolves.toEqual([]);
  });

  it("fails soft (empty array) when the response violates the schema", async () => {
    const fetchImpl = fetchWithContent(JSON.stringify({
      candidates: [{ text: "x", category: "not_a_real_category", confidence: 2 }],
    }));

    await expect(extractMemoryCandidates({
      transcript: "Some turn.",
      reply: "Some reply.",
      env,
      fetchImpl,
    })).resolves.toEqual([]);
  });

  it("fails soft (empty array) when the provider request itself fails", async () => {
    const fetchImpl: typeof fetch = async () => new Response("nope", { status: 500 });

    await expect(extractMemoryCandidates({
      transcript: "Some turn.",
      reply: "Some reply.",
      env,
      fetchImpl,
    })).resolves.toEqual([]);
  });

  it("returns an empty array with no provider configured, without calling fetch", async () => {
    const noProviders = parseServerEnv({});
    let called = false;
    const fetchImpl: typeof fetch = async () => {
      called = true;
      return new Response("{}", { status: 200 });
    };

    await expect(extractMemoryCandidates({
      transcript: "Some turn.",
      reply: "Some reply.",
      env: noProviders,
      fetchImpl,
    })).resolves.toEqual([]);
    expect(called).toBe(false);
  });
});
