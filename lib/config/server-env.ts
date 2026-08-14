import "server-only";

import { parseServerEnv } from "./env-schema";

export function getServerEnv() {
  return parseServerEnv(process.env);
}
