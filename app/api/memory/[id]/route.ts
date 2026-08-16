import { NextResponse } from "next/server";
import { z } from "zod";

import { getServerEnv } from "@/lib/config/server-env";
import { getPool } from "@/lib/db/pool";
import { hashElderToken, readElderTokenFromCookieHeader } from "@/lib/memory/elder-session";
import { findElderIdByHash, updateMemoryStatus, type QueryFn } from "@/lib/memory/repository";
import { isSameOrigin } from "@/lib/realtime/request-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ action: z.enum(["approve", "discard"]) }).strict();
const idSchema = z.uuid();

function errorResponse(status: number, code: string) {
  return NextResponse.json({ error: { code } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const env = getServerEnv();

  if (!isSameOrigin(request.headers.get("origin"), env.APP_ORIGIN)) {
    return errorResponse(403, "origin_not_allowed");
  }
  if (!env.ENABLE_MEMORY) return errorResponse(404, "memory_not_enabled");

  const pool = getPool(env);
  const key = env.MEMORY_ENCRYPTION_KEY;
  if (!pool || !key) return errorResponse(404, "memory_not_configured");

  const { id } = await params;
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return errorResponse(400, "invalid_id");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_request");
  }
  const parsedBody = bodySchema.safeParse(body);
  if (!parsedBody.success) return errorResponse(400, "invalid_action");

  const token = readElderTokenFromCookieHeader(request.headers.get("cookie"));
  if (!token) return errorResponse(403, "no_elder_session");

  const query: QueryFn = (text, queryParams) => pool.query(text, queryParams);

  try {
    const elderId = await findElderIdByHash({ query, hash: hashElderToken(token) });
    if (!elderId) return errorResponse(404, "not_found");

    const updated = parsedBody.data.action === "approve"
      ? await updateMemoryStatus({
        query,
        id: parsedId.data,
        elderId,
        status: "approved",
        userConfirmed: true,
        // A person just explicitly confirmed this -- maximal confidence is
        // the correct signal, and it's what clears selectMemoryContext's
        // 0.85 floor regardless of the extractor's original (possibly low)
        // guess. Without this, approving a low-confidence pending item
        // would show it as "Remembered" while it silently never surfaced.
        confidence: 1,
      })
      // Overwrite the content too: "Not saved" must never show real text,
      // whether the gate discarded it automatically or a person did.
      : await updateMemoryStatus({
        query,
        id: parsedId.data,
        elderId,
        status: "discarded",
        userConfirmed: false,
        overwrite: { key, text: "[discarded: user_declined]" },
      });

    if (!updated) return errorResponse(404, "not_found");
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return errorResponse(502, "memory_update_failed");
  }
}
