/**
 * System endpoints (Phase 12): /api/v1/health, /api/v1/providers and
 * /api/v1/scanner.
 *
 * - health: public liveness probe (no auth).
 * - providers: per-source ingestion status from the last worker heartbeat
 *   (OddsSource.status / lastSeenAt).
 * - scanner: aggregated scanner-run health from ScannerHealth heartbeats.
 */

import { requireAuth } from "../auth";
import { jsonOk } from "../http";
import type { HandlerDeps } from "./common";

const SCANNER_RUNS = 50;
const STALE_RUN_MS = 5 * 60 * 1000;

export async function health(): Promise<Response> {
  return jsonOk({
    status: "ok",
    service: "@22void/web",
    api: "v1",
    time: new Date().toISOString(),
  });
}

export async function listProviders(request: Request, deps: HandlerDeps): Promise<Response> {
  const auth = requireAuth(request, deps.env);
  if (auth instanceof Response) return auth;

  const providers = await deps.repo.listProviders();
  return jsonOk({ data: providers });
}

export async function scannerStatus(request: Request, deps: HandlerDeps): Promise<Response> {
  const auth = requireAuth(request, deps.env);
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