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

import { createPrismaClient } from "./client";
import type { PrismaClient } from "./generated/client/client";

export { createPrismaClient, getPrismaClient, prisma } from "./client";
export * from "./generated/client/client";
export {
  storeRawPayload,
  ensureOddsSource,
  type StoreRawPayloadInput,
  type OddsSourceLink,
} from "./raw-payloads";
export {
  persistCanonicalRun,
  toSelectionOutcomeType,
  loadPricedSelections,
  markSourceStatus,
  recordHeartbeat,
  completeHeartbeat,
  persistOpportunity,
  type PersistEventInput,
  type PersistEventSourceInput,
  type PersistMarketInput,
  type PersistSelectionInput,
  type PersistInvalidRef,
  type PersistCanonicalRunInput,
  type PersistCanonicalRunResult,
  type DbSourceStatus,
  type DbPricedSelection,
  type RecordHeartbeatInput,
  type CompleteHeartbeatInput,
  type HeartbeatRow,
  type PersistOpportunityLegInput,
  type PersistOpportunityAuditInput,
  type PersistOpportunityInput,
} from "./store";
export {
  computeOpportunityKey,
  legKeyFromSelectionIds,
  loadOddsHistory,
  listOpportunityEpisodes,
  getEpisodeReconstruction,
  sweepOpportunityEpisodes,
  sourceLatencyStats,
  falsePositiveAnalysis,
  type OddsHistoryFilter,
  type OddsHistoryPoint,
  type OpportunityEpisodeSummary,
  type ListEpisodeOptions,
  type LegMovement,
  type LegReconstructionView,
  type DetectionSnapshotView,
  type EpisodeReconstruction,
  type OpportunityEpisodeUpsertInput,
  type OpportunityEpisodeUpsertResult,
  type ReconcileResult,
  type SourceLatencyStat,
  type SourceLatencyOptions,
  type FalsePositiveByStatus,
  type FalsePositiveReport,
} from "./history";
export { encodeCursor, decodeCursor, type Cursor, type CursorDirection } from "./api/cursor";
export {
  AuditWriteError,
  createAuditQueue,
  enqueueAuditLog,
  writeAuditLog,
  type AuditQueueOptions,
  type AuditQueueStats,
  type WriteAuditLogInput,
} from "./audit";
export { createApiRepo, createHistoryRepo } from "./api/repo";
export type {
  Page,
  EventFilter,
  MarketFilter,
  OddsFilter,
  OpportunityFilter,
  AuditLogFilter,
  EventView,
  EventSourceLinkView,
  MarketView,
  OddsView,
  OpportunityView,
  OpportunityLegView,
  ProviderView,
  AdminSourceView,
  ScannerRunView,
  AuditLogView,
  ApiRepo,
  HistoryRepo,
  EpisodeHistoryFilter,
  OddsHistoryFilterView,
  SourceLatencyFilter,
  FalsePositiveFilter,
} from "./api/types";

/** Minimal health probe shape for the persistence layer. */
export interface DbHealth {
  reachable: boolean;
  latencyMs?: number;
}

export interface DbHealthOptions {
  /**
   * Wall-clock budget for the whole probe, in ms (default 5000). A probe that
   * exceeds it reports `reachable: false` instead of pinning a socket forever,
   * which matters because readiness probes run unauthenticated.
   */
  timeoutMs?: number;
  /** Clock override for deterministic tests. */
  now?: () => number;
}

/**
 * Force a libpq connect timeout onto a postgres URL when the caller has not set
 * one. Without it, a blackholed address leaves the TCP connect pending for the
 * OS default (minutes), so the probe timeout alone would not free the socket.
 */
export function withConnectTimeout(connectionString: string, timeoutSeconds: number): string {
  try {
    const url = new URL(connectionString);
    if (!url.searchParams.has("connect_timeout")) {
      url.searchParams.set("connect_timeout", String(timeoutSeconds));
    }
    return url.toString();
  } catch {
    return connectionString;
  }
}

/**
 * Connection ceiling for a health-probe pool. `SELECT 1` needs exactly one
 * connection, so one in use plus one spare is enough; the previous code created
 * a fresh `PrismaPg` pool per call and disconnected it in a `finally`, so an
 * unauthenticated readiness endpoint opened and tore down a whole pool — up to
 * `pg`'s default of ten connections — on every request. Churning pools like that
 * is a connection-exhaustion lever against Postgres even though each one is
 * short-lived, because the churn is continuous and the peak overlaps.
 */
const HEALTH_PROBE_POOL_MAX = 2;

const healthProbeClients = new Map<string, PrismaClient>();

/**
 * Cached, size-capped pool for readiness probes.
 *
 * Keyed by connection string *and* connect timeout, because the connect timeout
 * is baked into the pool's configuration: two callers with different budgets
 * must not silently share a pool built for the slower one.
 */
function healthProbeClient(connectionString: string, timeoutMs: number): PrismaClient {
  const connectTimeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  const key = `${connectTimeoutSeconds}|${connectionString}`;
  const cached = healthProbeClients.get(key);
  if (cached !== undefined) return cached;
  const client = createPrismaClient(withConnectTimeout(connectionString, connectTimeoutSeconds), {
    max: HEALTH_PROBE_POOL_MAX,
    connectionTimeoutMillis: timeoutMs,
    idleTimeoutMillis: 30_000,
  });
  healthProbeClients.set(key, client);
  return client;
}

/**
 * Disconnect and forget every cached health-probe pool. The probe pools are
 * process-lifetime by design, so this exists for tests and graceful shutdown
 * rather than for the request path.
 */
export async function closeHealthProbeClients(): Promise<void> {
  const clients = [...healthProbeClients.values()];
  healthProbeClients.clear();
  await Promise.all(clients.map((client) => client.$disconnect().catch(() => undefined)));
}

/** Runs `SELECT 1` against the given connection string, bounded by `timeoutMs`. */
export async function checkDbHealth(
  connectionString: string,
  options: DbHealthOptions = {}
): Promise<DbHealth> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const now = options.now ?? (() => performance.now());
  const startedAt = now();
  const client = healthProbeClient(connectionString, timeoutMs);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`database health probe timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });

  try {
    await Promise.race([client.$queryRaw`SELECT 1`, expiry]);
    return { reachable: true, latencyMs: now() - startedAt };
  } catch (error) {
    console.warn("[@22void/db] health probe failed", error);
    return { reachable: false };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    // The pool is cached and reused, so it is deliberately *not* disconnected
    // here. Tearing it down per probe is what exhausted connections; call
    // closeHealthProbeClients() to release it.
  }
}
