import { describe, expect, it, vi } from "vitest";

import { parseServerEnv } from "../../lib/config/env-schema";
import { decryptMemoryText, encryptMemoryText } from "../../lib/memory/crypto";
import type { ExtractedMemoryCandidate } from "../../lib/memory/extractor";
import { loadStoredMemoriesForTurn, runMemoryPipeline } from "../../lib/memory/pipeline";
import type { QueryFn } from "../../lib/memory/repository";

const KEY = "test-memory-key";
const env = parseServerEnv({ MEMORY_ENCRYPTION_KEY: KEY, DATABASE_URL: "postgresql://ignored/ignored" });

function fakeQuery(): { query: QueryFn; calls: { sql: string; params: unknown[] }[] } {
  const calls: { sql: string; params: unknown[] }[] = [];
  const query: QueryFn = async (sql, params = []) => {
    calls.push({ sql, params });
    if (/insert into elders/i.test(sql)) return { rows: [{ id: "elder-1" }] };
    return { rows: [] };
  };
  return { query, calls };
}

function extractorReturning(candidates: ExtractedMemoryCandidate[]) {
  return async () => candidates;
}

describe("loadStoredMemoriesForTurn", () => {
  // Regression: this used to be an ensureElder (upsert) call made directly
  // in the route handler before the turn ran. If the turn then failed, the
  // row it created was orphaned -- created but never reachable, since the
  // cookie that would let it be found again was never sent. This must be
  // strictly read-only.
  it("never issues a write -- only ever a SELECT, even when nothing is found", async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const query: QueryFn = async (sql, params = []) => {
      calls.push({ sql, params });
      return { rows: [] };
    };

    const memories = await loadStoredMemoriesForTurn({ query, key: KEY, elderHash: "hash-1" });

    expect(memories).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toMatch(/select id from elders/i);
    expect(calls.some((call) => /\b(?:insert|update|upsert)\b/i.test(call.sql))).toBe(false);
  });

  it("returns the elder's approved memories when the elder row already exists", async () => {
    const approvedRow = {
      id: "item-1",
      kind: "profile",
      status: "approved",
      content_ciphertext: encryptMemoryText("Enjoys old Kishore Kumar songs", KEY),
      confidence: "0.950",
      user_confirmed: true,
      updated_at: "2026-08-01T00:00:00.000Z",
      expires_at: null,
    };
    const calls: { sql: string }[] = [];
    const query: QueryFn = async (sql) => {
      calls.push({ sql });
      if (/select id from elders/i.test(sql)) return { rows: [{ id: "elder-1" }] };
      return { rows: [approvedRow] };
    };

    const memories = await loadStoredMemoriesForTurn({ query, key: KEY, elderHash: "hash-1" });

    expect(memories).toHaveLength(1);
    expect(memories[0]?.text).toBe("Enjoys old Kishore Kumar songs");
    // Word-boundary regex: a naive /update/i would false-positive on the
    // "updated_at" column name in the SELECT itself.
    expect(calls.some((call) => /\b(?:insert|update|upsert)\b/i.test(call.sql))).toBe(false);
  });
});

describe("runMemoryPipeline", () => {
  it("never writes real content for a financial candidate -- only a category label", async () => {
    const { query, calls } = fakeQuery();

    await runMemoryPipeline({
      elderHash: "hash-1",
      transcript: "My son sent 5000 rupees for the doctor again.",
      reply: "That's kind of him.",
      env,
      query,
      extract: extractorReturning([
        { text: "Son sends money for doctor visits", category: "financial", confidence: 0.9 },
      ]),
    });

    const insertCall = calls.find((call) => /insert into memory_items/i.test(call.sql));
    expect(insertCall).toBeDefined();
    const [, , status, ciphertext] = insertCall!.params as [string, string, string, Buffer];
    expect(status).toBe("discarded");
    const stored = decryptMemoryText(ciphertext, KEY);
    expect(stored).toBe("[discarded: financial]");
    expect(stored).not.toContain("5000");
    expect(stored).not.toContain("Son sends money");
  });

  it("stores a safe, confident preference as pending (not yet user-confirmed)", async () => {
    const { query, calls } = fakeQuery();

    await runMemoryPipeline({
      elderHash: "hash-1",
      transcript: "I love listening to old Kishore Kumar songs in the evening.",
      reply: "That sounds lovely.",
      env,
      query,
      extract: extractorReturning([
        { text: "Enjoys listening to old Kishore Kumar songs", category: "preference", confidence: 0.95 },
      ]),
    });

    const insertCall = calls.find((call) => /insert into memory_items/i.test(call.sql));
    const [, kind, status, ciphertext, , , userConfirmed] = insertCall!.params as
      [string, string, string, Buffer, string, number, boolean];
    expect(kind).toBe("profile");
    expect(status).toBe("pending");
    expect(userConfirmed).toBe(false);
    expect(decryptMemoryText(ciphertext, KEY)).toBe("Enjoys listening to old Kishore Kumar songs");
  });

  it("does nothing when there is nothing to remember", async () => {
    const { query, calls } = fakeQuery();

    await runMemoryPipeline({
      elderHash: "hash-1",
      transcript: "Okay, thank you.",
      reply: "You're welcome.",
      env,
      query,
      extract: extractorReturning([]),
    });

    expect(calls.some((call) => /insert into memory_items/i.test(call.sql))).toBe(false);
  });

  it("never throws when the query function itself fails", async () => {
    const query: QueryFn = async () => { throw new Error("connection lost"); };

    await expect(runMemoryPipeline({
      elderHash: "hash-1",
      transcript: "Some turn.",
      reply: "Some reply.",
      env,
      query,
      extract: extractorReturning([
        { text: "irrelevant", category: "preference", confidence: 0.9 },
      ]),
    })).resolves.toBeUndefined();
  });

  it("does nothing when MEMORY_ENCRYPTION_KEY is not set", async () => {
    const unconfigured = parseServerEnv({ DATABASE_URL: "postgresql://ignored/ignored" });
    const { query, calls } = fakeQuery();
    const extract = vi.fn(extractorReturning([]));

    await runMemoryPipeline({
      elderHash: "hash-1",
      transcript: "Some turn.",
      reply: "Some reply.",
      env: unconfigured,
      query,
      extract,
    });

    expect(extract).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });
});
