import "server-only";

import type { ServerEnv } from "@/lib/config/env-schema";
import { getPool } from "@/lib/db/pool";
import { hashElderToken } from "@/lib/memory/elder-session";
import { findElderIdByHash, listMemoryItems, type QueryFn } from "@/lib/memory/repository";

// Shared by app/memory/page.tsx (initial server-rendered load, using the
// cookie already on the request) and app/api/memory/route.ts (client-side
// reload after an approve/discard action) so both read the review screen's
// data the exact same way.
const DISCARD_LABEL = /^\[discarded:\s*([a-z_]+)\]$/;

export type VisibleItem = { id: string; kind: string; updatedAt: string; text: string };
export type DiscardedItem = { id: string; kind: string; updatedAt: string; category: string };
export type MemoryReviewData = {
  configured: boolean;
  approved: VisibleItem[];
  pending: VisibleItem[];
  discarded: DiscardedItem[];
};

function toVisible(item: { id: string; kind: string; text: string; updatedAt: Date }): VisibleItem {
  return { id: item.id, kind: item.kind, updatedAt: item.updatedAt.toISOString(), text: item.text };
}

function toDiscarded(item: { id: string; kind: string; text: string; updatedAt: Date }): DiscardedItem {
  const match = DISCARD_LABEL.exec(item.text);
  return {
    id: item.id,
    kind: item.kind,
    updatedAt: item.updatedAt.toISOString(),
    category: match?.[1] ?? "unknown",
  };
}

const EMPTY_CONFIGURED: MemoryReviewData = { configured: true, approved: [], pending: [], discarded: [] };
const EMPTY_UNCONFIGURED: MemoryReviewData = { configured: false, approved: [], pending: [], discarded: [] };

export async function loadMemoryReviewData(
  env: ServerEnv,
  elderToken: string | null,
): Promise<MemoryReviewData> {
  if (!env.ENABLE_MEMORY) return EMPTY_UNCONFIGURED;

  const pool = getPool(env);
  const key = env.MEMORY_ENCRYPTION_KEY;
  if (!pool || !key) return EMPTY_UNCONFIGURED;
  if (!elderToken) return EMPTY_CONFIGURED;

  const query: QueryFn = (text, params) => pool.query(text, params);

  const elderId = await findElderIdByHash({ query, hash: hashElderToken(elderToken) });
  if (!elderId) return EMPTY_CONFIGURED;

  const items = await listMemoryItems({ query, key, elderId });
  return {
    configured: true,
    approved: items.filter((item) => item.status === "approved").map(toVisible),
    pending: items.filter((item) => item.status === "pending").map(toVisible),
    discarded: items.filter((item) => item.status === "discarded").map(toDiscarded),
  };
}
