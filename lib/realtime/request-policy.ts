import { createHash } from "node:crypto";

type RateEntry = {
  count: number;
  resetAt: number;
};

export class LocalRateLimiter {
  private readonly entries = new Map<string, RateEntry>();

  constructor(
    private readonly limit = 5,
    private readonly windowMs = 60_000,
  ) {}

  consume(identifier: string, now = Date.now()) {
    const key = createHash("sha256").update(identifier).digest("hex");
    const current = this.entries.get(key);

    if (!current || current.resetAt <= now) {
      this.entries.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (current.count >= this.limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
      };
    }

    current.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

export function isSameOrigin(requestOrigin: string | null, appOrigin: string) {
  if (!requestOrigin) return false;

  try {
    return new URL(requestOrigin).origin === new URL(appOrigin).origin;
  } catch {
    return false;
  }
}

export function createSafetyIdentifier(appOrigin: string) {
  return createHash("sha256")
    .update(`saathi-local-user-v1|${appOrigin}`)
    .digest("hex")
    .slice(0, 32);
}
