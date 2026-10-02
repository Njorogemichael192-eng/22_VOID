import { jsonError } from "@/lib/api/http";
import { ready } from "@/lib/api/handlers/system";
import { checkInternalOnly } from "@/lib/security/internal-only";

/**
 * Readiness probe.
 *
 * Always dynamic: a statically cached 200 would tell the load balancer a
 * backend is ready when its database went down hours ago.
 */
export const dynamic = "force-dynamic";

/**
 * Restricted to internal callers (see `checkInternalOnly`). This endpoint is
 * unauthenticated by necessity, so the restriction is what keeps the outside
 * world from using it as a database liveness oracle or a probe amplifier.
 */
export async function GET(request: Request) {
  const decision = checkInternalOnly(request);
  if (!decision.allowed) {
    return jsonError("FORBIDDEN", "Readiness is restricted to internal callers.", 403, {
      reason: decision.reason,
    });
  }

  const response = await ready();
  // Proxies must never serve a stored readiness verdict, in either direction.
  response.headers.set("cache-control", "no-store, max-age=0");
  return response;
}
