import { describe, expect, it, vi } from "vitest";

import { encryptMemoryText } from "../../lib/memory/crypto";
import {
  ensureElder,
  findElderIdByHash,
  insertMemoryItem,
  listMemoryItems,
  updateMemoryStatus,
  type QueryFn,
} from "../../lib/memory/repository";

const KEY = "test-memory-key";

describe("ensureElder", () => {
  it("upserts by external_identity_hash and returns the row id", async () => {
    const query = vi.fn<QueryFn>().mockResolvedValue({ rows: [{ id: "elder-1" }] });

    const id = await ensureElder({ query, hash: "hash-abc", preferredLanguage: "hi-IN" });

    expect(id).toBe("elder-1");
    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toMatch(/insert into elders/i);
    expect(sql).toMatch(/on conflict \(external_identity_hash\)/i);
    expect(params).toEqual(["hash-abc", "hi-IN"]);
  });

  it("throws if the database returns no row", async () => {
    const query = vi.fn<QueryFn>().mockResolvedValue({ rows: [] });
    await expect(ensureElder({ query, hash: "hash-abc" })).rejects.toThrow();
  });
});

describe("findElderIdByHash", () => {
  it("returns the id when found, without creating anything", async () => {
    const query = vi.fn<QueryFn>().mockResolvedValue({ rows: [{ id: "elder-1" }] });
    await expect(findElderIdByHash({ query, hash: "hash-abc" })).resolves.toBe("elder-1");
    expect(query.mock.calls[0]?.[0]).toMatch(/select id from elders/i);
    expect(query.mock.calls[0]?.[0]).not.toMatch(/insert/i);
  });

  it("returns null when no elder matches", async () => {
    const query = vi.fn<QueryFn>().mockResolvedValue({ rows: [] });
    await expect(findElderIdByHash({ query, hash: "hash-abc" })).resolves.toBeNull();
  });
});

describe("insertMemoryItem", () => {
  it("encrypts the text before inserting; plaintext never reaches the query", async () => {
    const query = vi.fn<QueryFn>().mockResolvedValue({ rows: [] });

    await insertMemoryItem({
      query,
      key: KEY,
      elderId: "elder-1",
      kind: "profile",
      status: "pending",
      text: "a private fact",
      sourceTurnHash: "hash-of-turn",
      confidence: 0.9,
      userConfirmed: false,
    });

    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toMatch(/insert into memory_items/i);
    const ciphertext = params![3] as Buffer;
    expect(Buffer.isBuffer(ciphertext)).toBe(true);
    expect(ciphertext.toString("utf8")).not.toContain("a private fact");
  });
});

describe("listMemoryItems", () => {
  it("decrypts every readable row and skips rows that fail to decrypt", async () => {
    const good = {
      id: "item-1",
      kind: "profile",
      status: "approved",
      content_ciphertext: encryptMemoryText("a remembered fact", KEY),
      confidence: "0.900",
      user_confirmed: true,
      updated_at: "2026-08-01T00:00:00.000Z",
      expires_at: null,
    };
    const unreadable = {
      id: "item-2",
      kind: "episode",
      status: "pending",
      content_ciphertext: encryptMemoryText("wrong key fact", "a-different-key"),
      confidence: "0.500",
      user_confirmed: false,
      updated_at: "2026-08-02T00:00:00.000Z",
      expires_at: null,
    };
    const query = vi.fn<QueryFn>().mockResolvedValue({ rows: [good, unreadable] });

    const items = await listMemoryItems({ query, key: KEY, elderId: "elder-1" });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "item-1",
      kind: "profile",
      status: "approved",
      text: "a remembered fact",
      confidence: 0.9,
      userConfirmed: true,
    });
  });
});

describe("updateMemoryStatus", () => {
  it("scopes the update to both id and elderId", async () => {
    const query = vi.fn<QueryFn>().mockResolvedValue({ rows: [{ id: "item-1" }] });

    const updated = await updateMemoryStatus({
      query,
      id: "item-1",
      elderId: "elder-1",
      status: "approved",
      userConfirmed: true,
    });

    expect(updated).toBe(true);
    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toMatch(/where id = \$1 and elder_id = \$2/i);
    expect(params).toEqual(["item-1", "elder-1", "approved", true, null]);
  });

  it("returns false when no row matched (wrong elder or missing id)", async () => {
    const query = vi.fn<QueryFn>().mockResolvedValue({ rows: [] });
    const updated = await updateMemoryStatus({
      query,
      id: "item-1",
      elderId: "someone-elses-elder",
      status: "approved",
      userConfirmed: true,
    });
    expect(updated).toBe(false);
  });

  it("re-encrypts the content when overwrite is given, so discarded rows never keep real text", async () => {
    const query = vi.fn<QueryFn>().mockResolvedValue({ rows: [{ id: "item-1" }] });

    await updateMemoryStatus({
      query,
      id: "item-1",
      elderId: "elder-1",
      status: "discarded",
      userConfirmed: false,
      overwrite: { key: KEY, text: "[discarded: user_declined]" },
    });

    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toMatch(/content_ciphertext = \$5/i);
    const ciphertext = params![4] as Buffer;
    expect(Buffer.isBuffer(ciphertext)).toBe(true);
  });

  it("overwrites confidence when given (approving a low-confidence pending item)", async () => {
    // Regression: gateMemory sends low-confidence candidates to "pending"
    // without ever raising their confidence, and selectMemoryContext
    // requires >= 0.85 to surface a memory in conversation. Approving used
    // to leave the original (possibly low) confidence untouched, so the
    // item showed as "Remembered" in the UI but silently never reached
    // conversation context.
    const query = vi.fn<QueryFn>().mockResolvedValue({ rows: [{ id: "item-1" }] });

    await updateMemoryStatus({
      query,
      id: "item-1",
      elderId: "elder-1",
      status: "approved",
      userConfirmed: true,
      confidence: 1,
    });

    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toMatch(/confidence = coalesce\(\$5, confidence\)/i);
    expect(params).toEqual(["item-1", "elder-1", "approved", true, 1]);
  });

  it("leaves confidence untouched when not given (e.g. a manual discard)", async () => {
    const query = vi.fn<QueryFn>().mockResolvedValue({ rows: [{ id: "item-1" }] });

    await updateMemoryStatus({
      query,
      id: "item-1",
      elderId: "elder-1",
      status: "discarded",
      userConfirmed: false,
      overwrite: { key: KEY, text: "[discarded: user_declined]" },
    });

    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toMatch(/confidence = coalesce\(\$6, confidence\)/i);
    expect(params![5]).toBeNull();
  });
});
