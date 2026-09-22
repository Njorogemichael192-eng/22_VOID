/**
 * Server-runtime wiring for Phase 12 route handlers: the Prisma-backed repo
 * plus process environment. Imported only from `/app/api/v1/**` so the db
 * package is never pulled into the client bundle.
 */

import { createApiRepo } from "@22void/db";
import { serverApiEnv } from "./env";
import type { HandlerDeps } from "./handlers/common";

export function serverHandlerDeps(): HandlerDeps {
  return { repo: createApiRepo(), env: serverApiEnv() };
}