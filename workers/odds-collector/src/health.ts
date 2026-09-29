import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

import { workerId } from "./identity.js";

export type HealthStatus = "ok" | "starting" | "degraded" | "down" | "error" | "stale";

export interface WorkerHealthEvaluation {
  readonly ready: boolean;
  readonly status: HealthStatus;
  readonly reason?: string;
  readonly ageMs?: number;
}

export interface WorkerHealthInput {
  readonly startedAt: number | string;
  readonly now: number;
  readonly lastCycleAt: number | string | null;
  readonly lastCycleStatus: string | null;
  readonly startupGraceMs: number;
  readonly staleAfterMs: number;
}

export interface WorkerHealthStateOptions {
  readonly startedAt?: number | string;
  readonly startupGraceMs?: number;
  readonly staleAfterMs?: number;
  readonly now?: () => number;
  readonly service?: string;
  readonly workerId?: string;
  readonly pid?: number;
}

export interface WorkerHealthSnapshot extends WorkerHealthEvaluation {
  readonly service: string;
  readonly workerId: string;
  readonly startedAt: string;
  readonly lastCycleAt: string | null;
  readonly lastCycleStatus: string | null;
  readonly runCount: number;
  readonly pid: number;
}

export interface WorkerHealthState {
  recordCycle(status: string, at?: number | string): void;
  snapshot(runCount?: number, now?: number): WorkerHealthSnapshot;
}

function timestampMs(value: number | string, name: string): number {
  const result = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(result)) throw new Error(`Invalid ${name}`);
  return result;
}

function optionalTimestampMs(value: number | string | null): number | null {
  if (value === null) return null;
  const result = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

function validateDurations(startupGraceMs: number, staleAfterMs: number): void {
  if (!Number.isFinite(startupGraceMs) || startupGraceMs < 0) {
    throw new Error("startupGraceMs must be a non-negative number");
  }
  if (!Number.isFinite(staleAfterMs) || staleAfterMs <= 0) {
    throw new Error("staleAfterMs must be a positive number");
  }
}

function lastStatusEvaluation(
  status: string,
  ageMs: number,
  staleAfterMs: number
): WorkerHealthEvaluation {
  const normalized = status.trim().toUpperCase();
  if (normalized === "DEGRADED") {
    return { ready: false, status: "degraded", reason: "last_cycle_degraded" };
  }
  if (normalized === "DOWN") {
    return { ready: false, status: "down", reason: "last_cycle_down" };
  }
  if (normalized === "ERROR") {
    return { ready: false, status: "error", reason: "last_cycle_error" };
  }
  if (normalized !== "OK" && normalized !== "HEALTHY") {
    return { ready: false, status: "starting", reason: "last_cycle_status_unknown" };
  }
  if (ageMs >= staleAfterMs) {
    return { ready: false, status: "stale", reason: "last_cycle_stale", ageMs };
  }
  return { ready: true, status: "ok", ageMs };
}

export function evaluateWorkerHealth(input: WorkerHealthInput): WorkerHealthEvaluation {
  validateDurations(input.startupGraceMs, input.staleAfterMs);
  const startedAt = timestampMs(input.startedAt, "startedAt");
  if (!Number.isFinite(input.now)) throw new Error("now must be a finite number");

  const lastCycleAt = optionalTimestampMs(input.lastCycleAt);
  if (lastCycleAt === null) {
    const startupAgeMs = Math.max(0, input.now - startedAt);
    if (startupAgeMs < input.startupGraceMs) {
      return { ready: true, status: "starting", reason: "startup_grace" };
    }
    return { ready: false, status: "starting", reason: "no_cycle_after_grace" };
  }

  if (input.lastCycleStatus === null) {
    return { ready: false, status: "starting", reason: "last_cycle_status_missing" };
  }
  const ageMs = Math.max(0, input.now - lastCycleAt);
  return lastStatusEvaluation(input.lastCycleStatus, ageMs, input.staleAfterMs);
}

function evaluationFields(evaluation: WorkerHealthEvaluation): {
  ready: boolean;
  status: HealthStatus;
  reason?: string;
  ageMs?: number;
} {
  return {
    ready: evaluation.ready,
    status: evaluation.status,
    ...(evaluation.reason === undefined ? {} : { reason: evaluation.reason }),
    ...(evaluation.ageMs === undefined ? {} : { ageMs: evaluation.ageMs }),
  };
}

export function createWorkerHealthState(options: WorkerHealthStateOptions = {}): WorkerHealthState {
  const clock = options.now ?? Date.now;
  const startedAt = timestampMs(options.startedAt ?? clock(), "startedAt");
  const startupGraceMs = options.startupGraceMs ?? 30_000;
  const staleAfterMs = options.staleAfterMs ?? 300_000;
  validateDurations(startupGraceMs, staleAfterMs);

  const service = options.service ?? "@22void/odds-collector";
  const id = options.workerId ?? workerId();
  const pid = options.pid ?? process.pid;
  let lastCycleAt: number | null = null;
  let lastCycleStatus: string | null = null;
  let cycleCount = 0;

  return {
    recordCycle(status: string, at: number | string = clock()): void {
      lastCycleAt = timestampMs(at, "lastCycleAt");
      lastCycleStatus = status;
      cycleCount += 1;
    },
    snapshot(runCount: number = cycleCount, now: number = clock()): WorkerHealthSnapshot {
      const evaluation = evaluateWorkerHealth({
        startedAt,
        now,
        lastCycleAt,
        lastCycleStatus,
        startupGraceMs,
        staleAfterMs,
      });
      return {
        ...evaluationFields(evaluation),
        service,
        workerId: id,
        startedAt: new Date(startedAt).toISOString(),
        lastCycleAt: lastCycleAt === null ? null : new Date(lastCycleAt).toISOString(),
        lastCycleStatus,
        runCount: Math.max(0, Math.trunc(runCount)),
        pid,
      };
    },
  };
}

/**
 * Headers carried by every health response.
 *
 * `no-store` matters as much here as it does on the web readiness route: a
 * cached 200 tells Docker the worker is healthy long after its last cycle went
 * stale, and the healthcheck is the only thing watching.
 */
export const HEALTH_RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  "content-type": "application/json",
  "cache-control": "no-store, max-age=0",
};

export interface HealthRequestOptions {
  readonly state: WorkerHealthState;
  readonly getRunCount: () => number;
}

export function createHealthRequestHandler(
  options: HealthRequestOptions
): (request: IncomingMessage, response: ServerResponse) => void {
  return (request, response): void => {
    const path = (request.url ?? "/").split("?", 1)[0] ?? "/";
    if (
      request.method !== "GET" ||
      (path !== "/livez" && path !== "/readyz" && path !== "/healthz")
    ) {
      response.writeHead(404, HEALTH_RESPONSE_HEADERS);
      response.end(JSON.stringify({ status: "not_found" }));
      return;
    }

    const snapshot = options.state.snapshot(options.getRunCount());
    const body = path === "/livez" ? { ...snapshot, status: "ok" as const } : snapshot;
    const statusCode = path === "/livez" || snapshot.ready ? 200 : 503;
    response.writeHead(statusCode, HEALTH_RESPONSE_HEADERS);
    response.end(JSON.stringify(body));
  };
}

export interface HealthServerOptions extends HealthRequestOptions {
  /** How long a client may take to finish sending its request headers. */
  readonly headersTimeoutMs?: number;
  /** How long a client may take to send a complete request. */
  readonly requestTimeoutMs?: number;
  /** How long an idle keep-alive connection is held open. */
  readonly keepAliveTimeoutMs?: number;
}

/**
 * Defaults chosen for an endpoint the container healthcheck polls every 15s.
 *
 * Node's own defaults are 60s for headers and 300s for a whole request, which
 * is far too generous here: a client that opens a socket and then stalls holds
 * a connection for minutes, and enough stalled connections crowd out the
 * healthcheck — so the one component able to report a wedged worker goes silent
 * at the same moment the worker does.
 */
const DEFAULT_HEADERS_TIMEOUT_MS = 5_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_KEEP_ALIVE_TIMEOUT_MS = 5_000;

/**
 * The health server with the timeouts already applied.
 *
 * Constructed here rather than in `main.ts` so the timeouts are part of what the
 * tests exercise over a real socket, instead of untested wiring in an entrypoint.
 */
export function createHealthServer(options: HealthServerOptions): Server {
  const server = createServer(createHealthRequestHandler(options));
  server.headersTimeout = options.headersTimeoutMs ?? DEFAULT_HEADERS_TIMEOUT_MS;
  server.requestTimeout = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  server.keepAliveTimeout = options.keepAliveTimeoutMs ?? DEFAULT_KEEP_ALIVE_TIMEOUT_MS;
  return server;
}
