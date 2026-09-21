/**
 * @22void/db
 *
 * Persistence access layer using the Prisma client (BUILD_AGENT_PROMPT Phase 1).
 * The Prisma schema lives in /prisma; this package exposes the shared client,
 * the generated Prisma types/enums, and access helpers. Tables: events, source
 * event IDs, teams/aliases, bookmakers, odds sources, markets, selections, odds
 * observations, settlement rules, opportunities, opportunity legs, audit logs,
 * scanner health (plus raw payload retention, spec §65).
 */

import { createPrismaClient } from "./client.js";

export { createPrismaClient, getPrismaClient, prisma } from "./client.js";
export * from "./generated/client/client";
export {
  storeRawPayload,
  ensureOddsSource,
  type StoreRawPayloadInput,
  type OddsSourceLink,
} from "./raw-payloads.js";

/** Minimal health probe shape for the persistence layer. */
export interface DbHealth {
  reachable: boolean;
  latencyMs?: number;
}

/** Runs `SELECT 1` against the given connection string. */
export async function checkDbHealth(connectionString: string): Promise<DbHealth> {
  const startedAt = performance.now();
  const client = createPrismaClient(connectionString);
  try {
    await client.$queryRaw`SELECT 1`;
    return { reachable: true, latencyMs: performance.now() - startedAt };
  } catch (error) {
    console.warn("[@22void/db] health probe failed", error);
    return { reachable: false };
  } finally {
    await client.$disconnect().catch(() => undefined);
  }
}
