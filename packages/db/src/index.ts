/**
 * @22void/db
 *
 * Persistence access layer using the Prisma client (BUILD_AGENT_PROMPT Phase 0–1).
 * The Prisma schema lives in /prisma; this package exposes the shared client and
 * typed access helpers. Tables: events, source event IDs, teams/aliases,
 * bookmakers, odds sources, markets, selections, odds observations, settlement
 * rules, opportunities, opportunity legs, audit logs, scanner health.
 *
 * Status: Phase 0 skeleton. Prisma client is scaffolded in Phase 1 with the
 * Supabase/PostgreSQL datasource.
 */

/** Placeholder re-export point for the Prisma client (Phase 1). */
export interface DbHealth {
  reachable: boolean;
  latencyMs?: number;
}