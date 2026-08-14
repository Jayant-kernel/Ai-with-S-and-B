import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";

import {
  emptyConversationContext,
  type ConversationContext,
  type ConversationMessage,
} from "@/lib/sarvam/settings";

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(1_500),
}).strict();

const metaSchema = z.object({
  turnCount: z.number().int().min(0).max(10_000),
  recentQuestionTurns: z.array(z.boolean()).max(2),
  lastObjective: z.string().max(64),
  lastRiskLevel: z.enum(["none", "concern", "urgent"]),
  lastSafetyConcern: z.string().max(64).default("none"),
  preferredLanguage: z.string().max(16),
}).strict();

const legacyStateSchema = z.object({
  version: z.literal(1),
  expiresAt: z.number().int(),
  messages: z.array(messageSchema).max(20),
}).strict();

const encryptedStateSchema = z.object({
  version: z.literal(2),
  expiresAt: z.number().int(),
  messages: z.array(messageSchema).max(20),
  meta: metaSchema,
}).strict();

export class ConversationStateError extends Error {
  constructor(readonly kind: "invalid" | "expired" | "unsupported") {
    super(`conversation_state_${kind}`);
    this.name = "ConversationStateError";
  }
}

function legacySignature(payload: string, secret: string) {
  return createHmac("sha256", secret)
    .update("saathi-sarvam-conversation-v1|")
    .update(payload)
    .digest("base64url");
}

function encryptionKey(secret: string) {
  return createHash("sha256")
    .update("saathi-sarvam-conversation-v2|")
    .update(secret)
    .digest();
}

function normalizeContext(input: ConversationMessage[] | ConversationContext): ConversationContext {
  return Array.isArray(input)
    ? { ...emptyConversationContext(), messages: input }
    : input;
}

export function createConversationState(
  input: ConversationMessage[] | ConversationContext,
  secret: string,
  now = Date.now(),
) {
  const context = normalizeContext(input);
  encryptedStateSchema.parse({
    version: 2,
    expiresAt: now + 30 * 60_000,
    messages: context.messages,
    meta: context.meta,
  });
  let messages = context.messages;

  while (true) {
    const state = {
      version: 2 as const,
      expiresAt: now + 30 * 60_000,
      messages,
      meta: context.meta,
    };
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
    cipher.setAAD(Buffer.from("saathi-sarvam-conversation-v2"));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(state), "utf8"),
      cipher.final(),
    ]);
    const token = [
      "v2",
      iv.toString("base64url"),
      ciphertext.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
    ].join(".");
    if (token.length <= 24_000) return token;
    if (messages.length <= 2) throw new ConversationStateError("invalid");
    messages = messages.slice(2);
  }
}

function readLegacyState(token: string, secret: string, now: number): ConversationContext {
  const [payload, suppliedSignature, extra] = token.split(".");
  if (!payload || !suppliedSignature || extra) throw new ConversationStateError("invalid");
  const expectedSignature = legacySignature(payload, secret);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new ConversationStateError("invalid");
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new ConversationStateError("invalid");
  }
  const parsed = legacyStateSchema.safeParse(decoded);
  if (!parsed.success) throw new ConversationStateError("unsupported");
  if (parsed.data.expiresAt <= now) throw new ConversationStateError("expired");
  return { ...emptyConversationContext(), messages: parsed.data.messages };
}

function readEncryptedState(token: string, secret: string, now: number): ConversationContext {
  const [version, ivValue, ciphertextValue, tagValue, extra] = token.split(".");
  if (version !== "v2" || !ivValue || !ciphertextValue || !tagValue || extra) {
    throw new ConversationStateError("invalid");
  }

  let decoded: unknown;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(secret),
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAAD(Buffer.from("saathi-sarvam-conversation-v2"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    decoded = JSON.parse(plaintext);
  } catch {
    throw new ConversationStateError("invalid");
  }

  const parsed = encryptedStateSchema.safeParse(decoded);
  if (!parsed.success) throw new ConversationStateError("unsupported");
  if (parsed.data.expiresAt <= now) throw new ConversationStateError("expired");
  return { messages: parsed.data.messages, meta: parsed.data.meta };
}

export function readConversationState(
  token: string | null,
  secret: string,
  now = Date.now(),
): ConversationContext {
  if (!token) return emptyConversationContext();
  if (token.length > 24_000) throw new ConversationStateError("invalid");
  return token.startsWith("v2.")
    ? readEncryptedState(token, secret, now)
    : readLegacyState(token, secret, now);
}
