import { describe, expect, it } from "vitest";

import {
  createSafetyIdentifier,
  isSameOrigin,
  LocalRateLimiter,
} from "../../lib/realtime/request-policy";

describe("Realtime request policy", () => {
  it("requires the configured origin", () => {
    expect(isSameOrigin("http://localhost:3000", "http://localhost:3000")).toBe(true);
    expect(isSameOrigin("https://example.com", "http://localhost:3000")).toBe(false);
    expect(isSameOrigin(null, "http://localhost:3000")).toBe(false);
  });

  it("limits repeated session creation attempts", () => {
    const limiter = new LocalRateLimiter(2, 60_000);

    expect(limiter.consume("browser", 1).allowed).toBe(true);
    expect(limiter.consume("browser", 2).allowed).toBe(true);
    expect(limiter.consume("browser", 3)).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
    expect(limiter.consume("browser", 60_001).allowed).toBe(true);
  });

  it("creates a stable pseudonymous safety identifier", () => {
    const first = createSafetyIdentifier("http://localhost:3000");
    const second = createSafetyIdentifier("http://localhost:3000");

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{32}$/);
    expect(first).not.toContain("localhost");
  });
});
