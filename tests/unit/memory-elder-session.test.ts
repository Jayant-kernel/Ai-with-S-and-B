import { describe, expect, it } from "vitest";

import {
  createElderToken,
  ELDER_COOKIE_NAME,
  hashElderToken,
  isValidElderToken,
  readElderTokenFromCookieHeader,
} from "../../lib/memory/elder-session";

describe("elder session token", () => {
  it("creates distinct, high-entropy tokens", () => {
    const first = createElderToken();
    const second = createElderToken();
    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(32);
  });

  it("hashes the same token identically and never returns the raw token", () => {
    const token = createElderToken();
    const hashOne = hashElderToken(token);
    const hashTwo = hashElderToken(token);
    expect(hashOne).toBe(hashTwo);
    expect(hashOne).not.toBe(token);
    expect(hashOne).toMatch(/^[a-f0-9]{64}$/);
  });

  it("hashes different tokens to different values", () => {
    expect(hashElderToken(createElderToken())).not.toBe(hashElderToken(createElderToken()));
  });

  it("reads the token back out of a Cookie header", () => {
    const token = createElderToken();
    const header = `other=1; ${ELDER_COOKIE_NAME}=${token}; another=2`;
    expect(readElderTokenFromCookieHeader(header)).toBe(token);
  });

  it("validates token shape directly, for readers that bypass the Cookie-header parser", () => {
    expect(isValidElderToken(createElderToken())).toBe(true);
    expect(isValidElderToken("too-short")).toBe(false);
    expect(isValidElderToken("has a space in it and is definitely long enough")).toBe(false);
  });

  it("returns null when the cookie is absent or malformed", () => {
    expect(readElderTokenFromCookieHeader(null)).toBeNull();
    expect(readElderTokenFromCookieHeader("unrelated=1")).toBeNull();
    expect(readElderTokenFromCookieHeader(`${ELDER_COOKIE_NAME}=not valid!!`)).toBeNull();
    expect(readElderTokenFromCookieHeader(`${ELDER_COOKIE_NAME}=`)).toBeNull();
  });
});
