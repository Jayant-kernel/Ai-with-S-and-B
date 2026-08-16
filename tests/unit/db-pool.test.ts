import { rootCertificates } from "node:tls";

import { beforeEach, describe, expect, it, vi } from "vitest";

// Regression: lib/db/pool.ts used to set `rejectUnauthorized: false` for
// every non-loopback host, disabling TLS certificate validation even for a
// production database. This mocks the `pg` module so the test can assert
// exactly what `ssl` option the Pool is constructed with, without opening
// a real connection.
const poolConstructorSpy = vi.fn();

vi.mock("pg", () => ({
  // Must be a real `function`, not an arrow function: `getPool` calls this
  // with `new Pool(...)`, and only a `function`/`class` can be a
  // constructor target -- an arrow function throws "is not a constructor".
  Pool: vi.fn().mockImplementation(function (config: unknown) {
    poolConstructorSpy(config);
    return { query: vi.fn() };
  }),
}));

const { getPool } = await import("../../lib/db/pool");
const { parseServerEnv } = await import("../../lib/config/env-schema");

function resetPoolCache() {
  delete (globalThis as unknown as { saathiPgPool?: unknown }).saathiPgPool;
}

describe("getPool", () => {
  beforeEach(() => {
    poolConstructorSpy.mockClear();
    resetPoolCache();
  });

  it("returns null and never constructs a Pool when DATABASE_URL is unset", () => {
    expect(getPool(parseServerEnv({}))).toBeNull();
    expect(poolConstructorSpy).not.toHaveBeenCalled();
  });

  it("enables TLS certificate verification for a remote (non-loopback) host", () => {
    getPool(parseServerEnv({
      DATABASE_URL: "postgresql://user:pass@db.example.supabase.co:5432/postgres",
    }));

    const [config] = poolConstructorSpy.mock.calls[0]!;
    expect(config.ssl.rejectUnauthorized).toBe(true);
    // Regression: connecting to a real Supabase pooler with only Node's
    // default trust store fails with SELF_SIGNED_CERT_IN_CHAIN -- Supabase
    // roots its chain at its own private CA (confirmed live). `ca` must be
    // Node's default roots *plus* Supabase's bundled root, not either alone
    // -- otherwise either Supabase or a public-CA host would fail to verify.
    expect(config.ssl.ca).toHaveLength(rootCertificates.length + 1);
    for (const cert of rootCertificates) expect(config.ssl.ca).toContain(cert);
    // The one extra entry is Supabase's bundled root (unique serial below).
    expect(config.ssl.ca.some((cert: string) => cert.includes("bLxMod62P2ktCiAkxnKJwtE9VPYw"))).toBe(true);
  });

  it("skips TLS entirely for loopback hosts (local dev Postgres)", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      poolConstructorSpy.mockClear();
      resetPoolCache();

      getPool(parseServerEnv({ DATABASE_URL: `postgresql://user:pass@${host}:5432/postgres` }));

      expect(poolConstructorSpy).toHaveBeenCalledWith(expect.objectContaining({ ssl: undefined }));
    }
  });

  it("caches the pool across calls instead of constructing a new one each time", () => {
    const env = parseServerEnv({ DATABASE_URL: "postgresql://user:pass@db.example.com:5432/postgres" });

    const first = getPool(env);
    const second = getPool(env);

    expect(first).toBe(second);
    expect(poolConstructorSpy).toHaveBeenCalledTimes(1);
  });
});
