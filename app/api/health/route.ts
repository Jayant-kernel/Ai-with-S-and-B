import { NextResponse } from "next/server";

import { buildHealthStatus } from "@/lib/config/health";
import { getServerEnv } from "@/lib/config/server-env";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(buildHealthStatus(getServerEnv()), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
