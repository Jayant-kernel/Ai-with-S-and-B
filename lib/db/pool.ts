import "server-only";

import { Pool } from "pg";
import { rootCertificates } from "node:tls";

import type { ServerEnv } from "@/lib/config/env-schema";

// Cached on globalThis so `next dev`'s hot-module-reload doesn't open a new
// pool (and leak connections) on every file save. Standard pattern for
// long-lived clients under Next.js dev, same reasoning as the Prisma docs.
const globalForPool = globalThis as unknown as { saathiPgPool?: Pool };

// Supabase's Postgres pooler (Supavisor) presents a chain rooted at
// Supabase's own private CA, not a public one -- Node's default trust
// store does NOT validate it (confirmed live: connecting with only the
// default trust store fails with SELF_SIGNED_CERT_IN_CHAIN). This is
// Supabase's actual, stable root CA (same cert across all their pooler
// endpoints, valid until 2031), not project-specific and not a secret --
// bundling it here keeps `rejectUnauthorized: true` (real verification)
// instead of disabling it. It's combined with Node's default root
// certificates below, so non-Supabase Postgres hosts (AWS RDS, etc. using
// publicly-trusted certs) keep working unchanged.
const SUPABASE_ROOT_CA = `-----BEGIN CERTIFICATE-----
MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l
dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh
c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow
azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD
YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug
Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW
QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q
DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2
GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi
cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4
O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt
NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX
uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt
aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU
tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b
VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6
jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx
Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2
CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P
o/bKiIz+Fq8=
-----END CERTIFICATE-----`;

function isLoopbackHost(connectionString: string) {
  try {
    const { hostname } = new URL(connectionString);
    // WHATWG URL's IPv6 serializer keeps the brackets in `.hostname`
    // (`"[::1]"`, not `"::1"`) -- check both forms rather than relying on
    // exactly which one a given runtime produces.
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

/**
 * Returns `null` when `DATABASE_URL` is unset so every caller can no-op
 * cleanly instead of throwing -- memory persistence is a best-effort side
 * feature, never a reason to fail a voice turn.
 */
export function getPool(env: ServerEnv): Pool | null {
  if (!env.DATABASE_URL) return null;
  if (!globalForPool.saathiPgPool) {
    globalForPool.saathiPgPool = new Pool({
      connectionString: env.DATABASE_URL,
      // Certificate validation stays on for every non-loopback host.
      // Passing a custom `ca` to Node's TLS replaces the default trust
      // store rather than extending it, so Node's own root certificates
      // are included alongside Supabase's, keeping other publicly-trusted
      // Postgres hosts (AWS RDS, etc.) working unchanged.
      ssl: isLoopbackHost(env.DATABASE_URL)
        ? undefined
        : { rejectUnauthorized: true, ca: [...rootCertificates, SUPABASE_ROOT_CA] },
      max: 5,
    });
  }
  return globalForPool.saathiPgPool;
}
