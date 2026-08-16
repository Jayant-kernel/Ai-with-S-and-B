import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

// Same AES-256-GCM construction as lib/sarvam/conversation-state.ts, packed
// as one Buffer (iv[12] + authTag[16] + ciphertext) instead of a dot-joined
// token string, since this fills a single `bytea` column rather than a
// value that has to survive round-tripping through a browser/form field.
const AAD = Buffer.from("saathi-memory-v1");

export class MemoryCryptoError extends Error {
  constructor() {
    super("memory_decrypt_failed");
    this.name = "MemoryCryptoError";
  }
}

function encryptionKey(secret: string): Buffer {
  return createHash("sha256").update("saathi-memory-v1|").update(secret).digest();
}

export function encryptMemoryText(text: string, secret: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptMemoryText(packed: Buffer, secret: string): string {
  if (packed.length < 28) throw new MemoryCryptoError();
  const iv = packed.subarray(0, 12);
  const authTag = packed.subarray(12, 28);
  const ciphertext = packed.subarray(28);

  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new MemoryCryptoError();
  }
}
