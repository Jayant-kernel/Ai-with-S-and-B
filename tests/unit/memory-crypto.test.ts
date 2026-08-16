import { describe, expect, it } from "vitest";

import { decryptMemoryText, encryptMemoryText, MemoryCryptoError } from "../../lib/memory/crypto";

describe("memory ciphertext", () => {
  it("round-trips text through encrypt/decrypt with the same key", () => {
    const packed = encryptMemoryText("Enjoys listening to old Kishore Kumar songs", "test-memory-key");
    expect(decryptMemoryText(packed, "test-memory-key")).toBe(
      "Enjoys listening to old Kishore Kumar songs",
    );
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const first = encryptMemoryText("same text", "test-memory-key");
    const second = encryptMemoryText("same text", "test-memory-key");
    expect(first.equals(second)).toBe(false);
  });

  it("fails to decrypt with the wrong key", () => {
    const packed = encryptMemoryText("private fact", "key-one");
    expect(() => decryptMemoryText(packed, "key-two")).toThrow(MemoryCryptoError);
  });

  it("detects any tampering of the packed buffer (GCM authentication)", () => {
    const packed = encryptMemoryText("private fact", "test-memory-key");
    const tampered = Buffer.from(packed);
    tampered[tampered.length - 1] = tampered[tampered.length - 1] ^ 0xff;
    expect(() => decryptMemoryText(tampered, "test-memory-key")).toThrow(MemoryCryptoError);
  });

  it("rejects a buffer too short to contain iv + auth tag", () => {
    expect(() => decryptMemoryText(Buffer.alloc(10), "test-memory-key")).toThrow(MemoryCryptoError);
  });
});
