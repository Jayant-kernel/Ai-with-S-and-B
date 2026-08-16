import "server-only";

import { Pool } from "pg";

import type { ServerEnv } from "@/lib/config/env-schema";

// Cached on globalThis so `next dev`'s hot-module-reload doesn't open a new
// pool (and leak connections) on every file save. Standard pattern for
// long-lived clients under Next.js dev, same reasoning as the Prisma docs.
const globalForPool = globalThis as unknown as { saathiPgPool?: Pool };

function isLoopbackHost(connectionString: string) {
  try {
    const { hostname } = new URL(connectionString);
    // WHATWG URL's IPv6 serializer keeps the brackets in `.hostname`
    // (`"[::1]"`, not `"::1"`) -- check both forms rather than relying on
    // exactly which one a given runtime produces.
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

/**
 * Returns `null` when `DATABASE_URL` is unset so every caller can no-op
 * cleanly instead of throwing -- memory persistence is a best-effort side
 * feature, never a reason to fail a voice turn.
 */
export function getPool(env: ServerEnv): Pool | null {
  if (!env.DATABASE_URL) return null;
  if (!globalForPool.saathiPgPool) {
    globalForPool.saathiPgPool = new Pool({
      connectionString: env.DATABASE_URL,
      // Certificate validation stays on for every non-loopback host: Node's
      // default trust store already validates modern Supabase pooler
      // endpoints. If a specific provider ever needs a custom CA, add
      // `ca: fs.readFileSync(...)` here rather than disabling verification.
      ssl: isLoopbackHost(env.DATABASE_URL) ? undefined : { rejectUnauthorized: true },
      max: 5,
    });
  }
  return globalForPool.saathiPgPool;
}
