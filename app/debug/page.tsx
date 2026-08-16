import { connection } from "next/server";

import { SarvamCompanion } from "@/components/companion/sarvam-companion";
import { buildHealthStatus } from "@/lib/config/health";
import { getServerEnv } from "@/lib/config/server-env";

export default async function DebugPage() {
  await connection();
  const health = buildHealthStatus(getServerEnv());

  return (
    <SarvamCompanion
      configured={health.sarvamConfigured}
      memoryConfigured={health.memoryConfigured}
      debug
    />
  );
}
