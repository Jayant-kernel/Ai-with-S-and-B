import "server-only";

import { createHash } from "node:crypto";

import type { ServerEnv } from "@/lib/config/env-schema";
import { getPool } from "@/lib/db/pool";
import type { StoredMemory } from "@/lib/memory/context";
import { extractMemoryCandidates, type ExtractedMemoryCandidate } from "@/lib/memory/extractor";
import { gateMemory, type MemoryCategory } from "@/lib/memory/gate";
import {
  ensureElder,
  findElderIdByHash,
  insertMemoryItem,
  listApprovedMemoriesForContext,
  type QueryFn,
} from "@/lib/memory/repository";

// Sensitivity category (from gateMemory) is a different taxonomy than the
// schema's context-priority `kind` (used by selectMemoryContext to weight
// durable facts over one-off episodes). This maps one onto the other.
// financial/secret map to "episode" too, but it's inert -- those always
// end up status "discarded" below, so `kind` is never read back for them.
function categoryToKind(category: MemoryCategory): StoredMemory["kind"] {
  switch (category) {
    case "preference":
    case "relationship":
      return "profile";
    case "future_event":
      return "thread";
    default:
      return "episode";
  }
}

function sourceTurnHash(transcript: string, reply: string): string {
  return createHash("sha256").update(transcript).update("|").update(reply).digest("hex");
}

function discardLabel(category: MemoryCategory): string {
  return `[discarded: ${category}]`;
}

/**
 * Read-only lookup used before a turn runs, to feed approved memories into
 * that turn's conversation context. Deliberately never creates an elder row
 * (uses findElderIdByHash, not ensureElder) -- a turn that hasn't happened
 * yet, and might still fail, must not have side effects. If no elder row
 * exists yet, there is nothing to remember anyway, so this just returns [].
 * The only place an elder row gets created is runMemoryPipeline below, via
 * next/server's after(), strictly after the turn has already succeeded.
 */
export async function loadStoredMemoriesForTurn(input: {
  query: QueryFn;
  key: string;
  elderHash: string;
}): Promise<StoredMemory[]> {
  const elderId = await findElderIdByHash({ query: input.query, hash: input.elderHash });
  if (!elderId) return [];
  return listApprovedMemoriesForContext({ query: input.query, key: input.key, elderId });
}

/**
 * Orchestrates extractor -> gateMemory (unmodified) -> repository. Intended
 * to be called from next/server's after() in app/api/sarvam/turn/route.ts,
 * strictly after the elder has already heard the spoken reply. Never
 * throws: memory is a best-effort side feature, not a reason to fail a turn.
 */
export async function runMemoryPipeline(input: {
  elderHash: string;
  transcript: string;
  reply: string;
  preferredLanguage?: string;
  env: ServerEnv;
  /** Test seam: bypasses getPool() with a fake query function. */
  query?: QueryFn;
  /** Test seam: overrides extractMemoryCandidates. */
  extract?: (args: {
    transcript: string;
    reply: string;
    env: ServerEnv;
  }) => Promise<ExtractedMemoryCandidate[]>;
}): Promise<void> {
  const key = input.env.MEMORY_ENCRYPTION_KEY;
  if (!key) return;

  let query = input.query;
  if (!query) {
    const pool = getPool(input.env);
    if (!pool) return;
    query = (text, params) => pool.query(text, params);
  }
  const extract = input.extract ?? extractMemoryCandidates;

  try {
    const elderId = await ensureElder({
      query,
      hash: input.elderHash,
      preferredLanguage: input.preferredLanguage,
    });

    const candidates = await extract({
      transcript: input.transcript,
      reply: input.reply,
      env: input.env,
    });
    if (candidates.length === 0) return;

    const hash = sourceTurnHash(input.transcript, input.reply);

    for (const candidate of candidates) {
      const decision = gateMemory({
        text: candidate.text,
        category: candidate.category,
        confidence: candidate.confidence,
        userConfirmed: false,
      });

      if (decision.disposition === "discard") {
        // Never the real content: only a category + reason are stored, so
        // the review screen can show what was noticed without ever
        // persisting the sensitive text itself.
        await insertMemoryItem({
          query,
          key,
          elderId,
          kind: categoryToKind(candidate.category),
          status: "discarded",
          text: discardLabel(candidate.category),
          sourceTurnHash: hash,
          confidence: candidate.confidence,
          userConfirmed: false,
        });
        continue;
      }

      // "store" is unreachable from fresh extraction today (userConfirmed
      // is always false here), but handled for a future caller that
      // re-submits an already-confirmed candidate.
      const status = decision.disposition === "store" ? "approved" : "pending";
      await insertMemoryItem({
        query,
        key,
        elderId,
        kind: categoryToKind(candidate.category),
        status,
        text: decision.sanitizedText ?? candidate.text,
        sourceTurnHash: hash,
        confidence: candidate.confidence,
        userConfirmed: status === "approved",
      });
    }
  } catch {
    // Best-effort: never let a DB/model failure surface out of after().
  }
}
