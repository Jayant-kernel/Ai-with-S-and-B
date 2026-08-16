export type StoredMemory = {
  id: string;
  kind: "profile" | "episode" | "thread";
  status: "pending" | "approved" | "discarded";
  text: string;
  confidence: number;
  userConfirmed: boolean;
  updatedAt: Date;
  expiresAt?: Date;
};

const kindPriority: Record<StoredMemory["kind"], number> = {
  profile: 3,
  thread: 2,
  episode: 1,
};

export function selectMemoryContext(input: {
  memories: StoredMemory[];
  privateMode: boolean;
  now?: Date;
  maxItems?: number;
  maxCharacters?: number;
}) {
  if (input.privateMode) return [];
  const now = input.now ?? new Date();
  const maxItems = input.maxItems ?? 8;
  const maxCharacters = input.maxCharacters ?? 2_000;
  let usedCharacters = 0;

  return input.memories
    .filter((item) =>
      item.status === "approved" &&
      item.userConfirmed &&
      item.confidence >= 0.85 &&
      (!item.expiresAt || item.expiresAt > now))
    .sort((left, right) =>
      kindPriority[right.kind] - kindPriority[left.kind] ||
      right.updatedAt.getTime() - left.updatedAt.getTime())
    .filter((item) => {
      if (usedCharacters + item.text.length > maxCharacters) return false;
      usedCharacters += item.text.length;
      return true;
    })
    .slice(0, maxItems)
    .map(({ kind, text }) => ({ kind, text }));
}

export function mayWriteMemory(privateMode: boolean) {
  return !privateMode;
}
