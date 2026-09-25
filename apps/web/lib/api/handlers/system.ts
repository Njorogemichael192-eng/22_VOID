/**
 * System endpoints (Phase 12): /api/v1/health, /api/v1/ready, /api/v1/providers
 * and /api/v1/scanner.
 *
 * - health: public liveness probe (no auth).
 * - ready: public readiness probe (no auth) — Caddy gates traffic on it, so it
 *   must stay cheap and un-cached by intermediaries. It is also unauthenticated,
 *   so the underlying database probe is memoised per process; see
 *   `READINESS_CACHE_TTL_MS`.
 * - providers: per-source ingestion status from the last worker heartbeat
 *   (OddsSource.status / lastSeenAt).
 * - scanner: aggregated scanner-run health from ScannerHealth heartbeats.
 */

import type { DbHealth } from "@22void/db";
import { guardRequest } from "../../security/guard";
import { jsonOk } from "../http";
import type { HandlerDeps } from "./common";

const SCANNER_RUNS = 50;
const STALE_RUN_MS = 5 * 60 * 1000;

/**
 * How long a readiness result is reused. `/api/v1/ready` is unauthenticated and
 * the default probe builds a fresh Prisma client (and therefore a fresh
 * connection pool) per call, so probing on every request turns a cheap health
 * check into a connection-exhaustion lever. Five seconds is far finer than the
 * 30s Caddy active-health interval that actually consumes the result.
 */
export const READINESS_CACHE_TTL_MS = 5_000;

/** Wall-clock budget for one real database probe. */
export const READINESS_PROBE_TIMEOUT_MS = 5_000;

export type DbHealthProbe = (
  connectionString: string,
  options?: { timeoutMs?: number },
) => Promise<DbHealth>;

export interface ReadyDeps {
  databaseUrl?: string;
  checkDbHealth?: DbHealthProbe;
  now?: () => number;
  cacheTtlMs?: number;
  probeTimeoutMs?: number;
}

interface ReadinessCacheEntry {
  at: number;
  reachable: boolean;
}

const readinessCache = new Map<string, ReadinessCacheEntry>();
const inFlightProbes = new Map<string, Promise<boolean>>();

/** Test helper: drop every memoised readiness result and in-flight probe. */
export function resetReadinessCache(): void {
  readinessCache.clear();
  inFlightProbes.clear();
}

const defaultDbHealthProbe: DbHealthProbe = async (connectionString, options) => {
  const { checkDbHealth } = await import("@22void/db");
  return checkDbHealth(connectionString, { timeoutMs: options?.timeoutMs });
};

async function probeDatabase(
  databaseUrl: string,
  probe: DbHealthProbe,
  timeoutMs: number,
): Promise<boolean> {
  const pending = inFlightProbes.get(databaseUrl);
  if (pending !== undefined) return pending;

  const work = (async () => {
    try {
      return (await probe(databaseUrl, { timeoutMs })).reachable === true;
    } catch {
      return false;
    }
  })();

  inFlightProbes.set(databaseUrl, work);
  try {
    return await work;
  } finally {
    inFlightProbes.delete(databaseUrl);
  }
}

export async function health(): Promise<Response> {
  return jsonOk({
    status: "ok",
    service: "@22void/web",
    api: "v1",
    time: new Date().toISOString(),
  });
}

export async function ready(deps: ReadyDeps = {}): Promise<Response> {
  const databaseUrl = deps.databaseUrl ?? process.env.DATABASE_URL;
  const configuredUrl =
    typeof databaseUrl === "string" && databaseUrl.trim().length > 0 ? databaseUrl : null;
  const now = deps.now ?? (() => Date.now());
  const at = now();
  let databaseReachable = false;

  if (configuredUrl !== null) {
    // An injected probe is a test seam, so it is not memoised; only the real
    // production probe is, which is the one that costs a connection pool.
    const injected = deps.checkDbHealth !== undefined;
    const ttl = deps.cacheTtlMs ?? READINESS_CACHE_TTL_MS;
    const cached = injected ? undefined : readinessCache.get(configuredUrl);

    if (cached !== undefined && at - cached.at < ttl) {
      databaseReachable = cached.reachable;
    } else {
      const probe = deps.checkDbHealth ?? defaultDbHealthProbe;
      databaseReachable = await probeDatabase(
        configuredUrl,
        probe,
        deps.probeTimeoutMs ?? READINESS_PROBE_TIMEOUT_MS,
      );
      if (!injected) readinessCache.set(configuredUrl, { at, reachable: databaseReachable });
    }
  }

  const isReady = configuredUrl !== null && databaseReachable;
  return jsonOk(
    {
      status: isReady ? "ok" : "not_ready",
      service: "@22void/web",
      checks: {
        databaseUrl: configuredUrl !== null,
        database: databaseReachable,
      },
      time: new Date(at).toISOString(),
    },
    { status: isReady ? 200 : 503 }
  );
}

export async function listProviders(request: Request, deps: HandlerDeps): Promise<Response> {
  const auth = guardRequest(request, deps);
  if (auth instanceof Response) return auth;

  const providers = await deps.repo.listProviders();
  return jsonOk({ data: providers });
}

export async function scannerStatus(request: Request, deps: HandlerDeps): Promise<Response> {
  const auth = guardRequest(request, deps);
  if (auth instanceof Response) return auth;

  const runs = await deps.repo.listScannerRuns(SCANNER_RUNS);
  const now = deps.now?.() ?? Date.now();
  const latest = runs.length > 0 ? runs[0] : null;
  const stale =
    latest !== null && runIsStale(latest, now)
      ? { sourceKey: latest.sourceKey ?? "unknown", since: latest.startedAt }
      : null;

  return jsonOk({
    data: runs,
    overall: {
      status: latest ? latest.status : "UNKNOWN",
      stale,
      lastRunAt: latest ? latest.startedAt : null,
      runningRuns: runs.filter((run) => run.finishedAt === null).length,
    },
  });
}

function runIsStale(
  run: { startedAt: string; finishedAt: string | null },
  now: number,
): boolean {
  const anchor = run.finishedAt ?? run.startedAt;
  const at = Date.parse(anchor);
  if (Number.isNaN(at)) return false;
  return now - at > STALE_RUN_MS;
}