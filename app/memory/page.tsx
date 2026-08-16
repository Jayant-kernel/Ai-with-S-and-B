import { cookies } from "next/headers";
import { connection } from "next/server";

import { MemoryReview } from "@/components/memory/memory-review";
import { getServerEnv } from "@/lib/config/server-env";
import { ELDER_COOKIE_NAME, isValidElderToken } from "@/lib/memory/elder-session";
import { loadMemoryReviewData, type MemoryReviewData } from "@/lib/memory/review-data";

const EMPTY: MemoryReviewData = { configured: true, approved: [], pending: [], discarded: [] };

export default async function MemoryPage() {
  await connection();
  const env = getServerEnv();
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(ELDER_COOKIE_NAME)?.value;
  const token = rawToken && isValidElderToken(rawToken) ? rawToken : null;

  let initialData = EMPTY;
  let initialLoadFailed = false;
  try {
    initialData = await loadMemoryReviewData(env, token);
  } catch {
    // A DB hiccup on first paint shouldn't break the page -- show the same
    // retryable error banner the client's own reload path already has.
    initialLoadFailed = true;
  }

  return <MemoryReview initialData={initialData} initialLoadFailed={initialLoadFailed} />;
}
