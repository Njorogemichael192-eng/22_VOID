/**
 * Server-runtime wiring for Phase 12 route handlers: the Prisma-backed repo
 * plus process environment. Imported only from `/app/api/v1/**` so the db
 * package is never pulled into the client bundle.
 */

import { createApiRepo, createHistoryRepo } from "@22void/db";
import { serverApiEnv } from "./env";
import { dbAudit } from "../security/audit";
import { ApiRateLimiter, rateLimitConfigFromEnv } from "../security/rate-limit";
import type { SecurityDeps } from "../security/guard";
import type { HandlerDeps } from "./handlers/common";
import type { HistoryHandlerDeps } from "./handlers/history";

/**
 * Shared Phase 16 guard options: one per-process rate limiter (configured from
 * API_RATE_LIMIT_CAPACITY / API_RATE_LIMIT_REFILL_PER_SECOND) and a
 * Postgres-backed security audit writer.
 */
const serverSecurityDeps: SecurityDeps = {
  rateLimiter: new ApiRateLimiter(rateLimitConfigFromEnv(process.env)),
  audit: dbAudit(),
};

export function serverHandlerDeps(): HandlerDeps {
  return { repo: createApiRepo(), env: serverApiEnv(), security: serverSecurityDeps };
}

export function serverHistoryDeps(): HistoryHandlerDeps {
  return { repo: createHistoryRepo(), env: serverApiEnv(), security: serverSecurityDeps };
}
