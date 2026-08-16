import "server-only";

import { decryptMemoryText, encryptMemoryText } from "@/lib/memory/crypto";
import type { StoredMemory } from "@/lib/memory/context";

// Dependency-injected query function, same shape node-postgres's
// Pool.query already has. Tests supply a fake implementation instead of a
// real Postgres connection -- mirrors the `fetchImpl` injection already
// used for HTTP calls in lib/ai/openai-compatible.ts and
// lib/companion/safety-observer.ts.
export type QueryFn = (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

export type MemoryItemStatus = "pending" | "approved" | "discarded";

type MemoryItemRow = {
  id: unknown;
  kind: unknown;
  status: unknown;
  content_ciphertext: unknown;
  confidence: unknown;
  user_confirmed: unknown;
  updated_at: unknown;
  expires_at: unknown;
};

function mapRow(row: Record<string, unknown>, key: string): StoredMemory {
  const typed = row as MemoryItemRow;
  return {
    id: String(typed.id),
    kind: typed.kind as StoredMemory["kind"],
    status: typed.status as StoredMemory["status"],
    text: decryptMemoryText(typed.content_ciphertext as Buffer, key),
    confidence: Number(typed.confidence),
    userConfirmed: Boolean(typed.user_confirmed),
    updatedAt: new Date(typed.updated_at as string),
    expiresAt: typed.expires_at ? new Date(typed.expires_at as string) : undefined,
  };
}

export async function ensureElder(input: {
  query: QueryFn;
  hash: string;
  preferredLanguage?: string;
}): Promise<string> {
  const result = await input.query(
    `insert into elders (external_identity_hash, preferred_language)
     values ($1, coalesce($2, 'hi-IN'))
     on conflict (external_identity_hash)
     do update set external_identity_hash = excluded.external_identity_hash
     returning id`,
    [input.hash, input.preferredLanguage ?? null],
  );
  const id = result.rows[0]?.id;
  if (typeof id !== "string") throw new Error("ensure_elder_failed");
  return id;
}

/**
 * Looks up an elder without creating one -- used by the review screen's
 * read/update routes, which must never mint an elder row just because
 * someone loaded the page. Only a completed voice turn (ensureElder, via
 * the memory pipeline) creates one.
 */
export async function findElderIdByHash(input: {
  query: QueryFn;
  hash: string;
}): Promise<string | null> {
  const result = await input.query(
    `select id from elders where external_identity_hash = $1`,
    [input.hash],
  );
  const id = result.rows[0]?.id;
  return typeof id === "string" ? id : null;
}

export async function insertMemoryItem(input: {
  query: QueryFn;
  key: string;
  elderId: string;
  kind: StoredMemory["kind"];
  status: MemoryItemStatus;
  text: string;
  sourceTurnHash: string;
  confidence: number;
  userConfirmed: boolean;
}): Promise<void> {
  const ciphertext = encryptMemoryText(input.text, input.key);
  await input.query(
    `insert into memory_items
       (elder_id, kind, status, content_ciphertext, source_turn_hash, confidence, user_confirmed)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.elderId,
      input.kind,
      input.status,
      ciphertext,
      input.sourceTurnHash,
      input.confidence,
      input.userConfirmed,
    ],
  );
}

/**
 * Lists every memory item for the review screen. A row whose ciphertext
 * fails to decrypt (e.g. after a key rotation) is skipped rather than
 * thrown -- one unreadable row must not break the whole screen.
 */
export async function listMemoryItems(input: {
  query: QueryFn;
  key: string;
  elderId: string;
}): Promise<StoredMemory[]> {
  const result = await input.query(
    `select id, kind, status, content_ciphertext, confidence, user_confirmed, updated_at, expires_at
     from memory_items
     where elder_id = $1
     order by updated_at desc
     limit 200`,
    [input.elderId],
  );
  const items: StoredMemory[] = [];
  for (const row of result.rows) {
    try {
      items.push(mapRow(row, input.key));
    } catch {
      // Skip unreadable rows; see doc comment above.
    }
  }
  return items;
}

/**
 * Scoped to elderId so one elder can never touch another elder's row. When
 * `overwrite` is given, the stored content is replaced too -- used when a
 * person manually discards a pending item, so "Not saved" stays consistent
 * with auto-discarded items and never displays real content either way.
 *
 * `confidence`, when given, overwrites the stored value; otherwise it's
 * left unchanged (`coalesce`). This matters for approval specifically:
 * gateMemory sends low-confidence candidates to "pending" without ever
 * raising their confidence, and selectMemoryContext requires >= 0.85 to
 * ever surface a memory in conversation -- so approving a low-confidence
 * item without also raising its confidence would show it as "Remembered"
 * in the UI while it silently never reaches a future turn's context.
 */
export async function updateMemoryStatus(input: {
  query: QueryFn;
  id: string;
  elderId: string;
  status: MemoryItemStatus;
  userConfirmed: boolean;
  confidence?: number;
  overwrite?: { key: string; text: string };
}): Promise<boolean> {
  const confidence = input.confidence ?? null;

  if (input.overwrite) {
    const ciphertext = encryptMemoryText(input.overwrite.text, input.overwrite.key);
    const result = await input.query(
      `update memory_items
       set status = $3, user_confirmed = $4, content_ciphertext = $5,
           confidence = coalesce($6, confidence)
       where id = $1 and elder_id = $2
       returning id`,
      [input.id, input.elderId, input.status, input.userConfirmed, ciphertext, confidence],
    );
    return result.rows.length > 0;
  }

  const result = await input.query(
    `update memory_items
     set status = $3, user_confirmed = $4, confidence = coalesce($5, confidence)
     where id = $1 and elder_id = $2
     returning id`,
    [input.id, input.elderId, input.status, input.userConfirmed, confidence],
  );
  return result.rows.length > 0;
}

/** Feeds lib/memory/context.ts's selectMemoryContext for the next turn. */
export async function listApprovedMemoriesForContext(input: {
  query: QueryFn;
  key: string;
  elderId: string;
}): Promise<StoredMemory[]> {
  const result = await input.query(
    `select id, kind, status, content_ciphertext, confidence, user_confirmed, updated_at, expires_at
     from memory_items
     where elder_id = $1 and status = 'approved' and (expires_at is null or expires_at > now())
     order by updated_at desc
     limit 50`,
    [input.elderId],
  );
  const memories: StoredMemory[] = [];
  for (const row of result.rows) {
    try {
      memories.push(mapRow(row, input.key));
    } catch {
      // Skip unreadable rows; see doc comment on listMemoryItems.
    }
  }
  return memories;
}
