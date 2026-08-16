import { NextResponse } from "next/server";

import { getServerEnv } from "@/lib/config/server-env";
import { readElderTokenFromCookieHeader } from "@/lib/memory/elder-session";
import { loadMemoryReviewData } from "@/lib/memory/review-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// No isSameOrigin check here, unlike the POST/PATCH memory routes: browsers
// only attach an Origin header to non-GET fetches, so requiring one on a
// same-origin GET would break this page's own fetch. CSRF protection for a
// GET instead comes from the elder cookie being SameSite=Lax -- a
// cross-site page's fetch() never carries it, so it can only ever see the
// same empty response an anonymous visitor would.
export async function GET(request: Request) {
  const env = getServerEnv();
  const token = readElderTokenFromCookieHeader(request.headers.get("cookie"));

  try {
    const data = await loadMemoryReviewData(env, token);
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { error: { code: "memory_read_failed" } },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
