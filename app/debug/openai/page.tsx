import { connection } from "next/server";

import { RealtimeCompanion } from "@/components/companion/realtime-companion";
import { buildHealthStatus } from "@/lib/config/health";
import { getServerEnv } from "@/lib/config/server-env";

export default async function OpenAIDebugPage() {
  await connection();
  const health = buildHealthStatus(getServerEnv());

  return <RealtimeCompanion configured={health.openaiConfigured} debug />;
}
