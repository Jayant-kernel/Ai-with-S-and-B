import "server-only";

import { createHash, randomBytes } from "node:crypto";

// Minimal stand-in for real auth: no login exists anywhere in this app yet.
// A long-lived, httpOnly, unsigned random cookie identifies "this browser"
// across sessions so memory can persist per elder. The raw token is the
// credential (32 random bytes, effectively unguessable); only its hash is
// ever stored, matching elders.external_identity_hash in the schema.
export const ELDER_COOKIE_NAME = "saathi_elder_id";
export const ELDER_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 730; // ~2 years

export function createElderToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashElderToken(token: string): string {
  return createHash("sha256").update("saathi-elder-identity-v1|").update(token).digest("hex");
}

/** base64url of 32 bytes: 43 chars, no padding -- exported so every reader
 *  (the Cookie-header parser below, and app/memory/page.tsx reading via
 *  next/headers' cookies()) applies the same validation. */
export function isValidElderToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{32,64}$/.test(token);
}

/**
 * Reads the elder token from a Cookie header (or `null` if absent/malformed)
 * and always returns the hash the caller needs to look up the elder row --
 * callers should never need to see the raw token beyond this call.
 */
export function readElderTokenFromCookieHeader(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === ELDER_COOKIE_NAME) {
      const value = rest.join("=");
      return value && isValidElderToken(value) ? value : null;
    }
  }
  return null;
}
