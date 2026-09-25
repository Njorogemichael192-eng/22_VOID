/**
 * odds-collector entrypoint (Phase 14).
 *
 * Env-driven:
 *   WORKER_PROVIDER              mock (default) | odds-api
 *   ODDS_API_KEY / ODDS_API_BASE_URL             (odds-api provider)
 *   DATABASE_URL                 when set, uses the Postgres store; otherwise in-memory
 *   SCANNER_POLL_INTERVAL_MS     cycle interval in ms (default 15000)
 *   RATE_LIMIT_CAPACITY          token bucket size (default 10)
 *   RATE_LIMIT_REFILL_PER_SECOND refill rate (default 5)
 *   WORKER_HEALTH_PORT           liveness/metrics endpoint port (default 8081)
 */

import "dotenv/config";

import { createServer } from "node:http";

import { MockProvider, OddsApiProvider } from "@22void/provider-contracts";
import { createPrismaClient } from "@22void/db";

import {
  resolveHealthConfig,
  resolveWorkerConfig,
  type ResolvedProviderConfig,
  type ResolvedStoreConfig,
} from "./config.js";
import {
  createHealthRequestHandler,
  createWorkerHealthState,
  type WorkerHealthState,
} from "./health.js";
import { TokenBucketRateLimiter } from "./rate-limit.js";
import { createScanWorker, nativeScheduler } from "./runtime.js";
import { createDbWorkerStore, createMemoryWorkerStore } from "./store.js";

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid ${name}=${raw}: expected a positive number`);
  }
  return value;
}

function createProvider(config: ResolvedProviderConfig): MockProvider | OddsApiProvider {
  if (config.kind === "odds-api") return new OddsApiProvider(config.config);
  return new MockProvider();
}

function createStore(config: ResolvedStoreConfig) {
  if (config.kind === "postgres") {
    const db = createPrismaClient(config.databaseUrl);
    return { store: createDbWorkerStore(db), label: "postgres" };
  }
  console.warn(
    "[odds-collector] DATABASE_URL unset — using the in-memory store (nothing persists)."
  );
  return { store: createMemoryWorkerStore(), label: "memory" };
}

function healthPort(): number {
  const raw = process.env.WORKER_HEALTH_PORT;
  if (raw === undefined || raw === "") return 8081;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid WORKER_HEALTH_PORT=${raw}: expected a port between 1 and 65535`);
  }
  return port;
}

function startHealthServer(state: WorkerHealthState, getRunCount: () => number) {
  const port = healthPort();
  const server = createServer(createHealthRequestHandler({ state, getRunCount }));

  server.listen(port, "0.0.0.0", () => {
    console.log(
      `[odds-collector] health endpoints listening on :${port}/livez, :${port}/readyz, :${port}/healthz`
    );
  });
  return server;
}

const processStartedAt = Date.now();

async function main(): Promise<void> {
  const resolved = resolveWorkerConfig();
  const healthConfig = resolveHealthConfig();
  const provider = createProvider(resolved.provider);
  const { store, label } = createStore(resolved.store);
  const intervalMs = numberEnv("SCANNER_POLL_INTERVAL_MS", 15_000);
  const capacity = numberEnv("RATE_LIMIT_CAPACITY", 10);
  const refillPerSecond = numberEnv("RATE_LIMIT_REFILL_PER_SECOND", 5);
  const rateLimiter = new TokenBucketRateLimiter({ capacity, refillPerSecond });
  const healthState = createWorkerHealthState({
    startedAt: processStartedAt,
    ...healthConfig,
  });

  console.log(
    `[odds-collector] starting provider=${provider.providerKey} store=${label} intervalMs=${intervalMs} rate=${capacity}/${refillPerSecond}`
  );

  const worker = createScanWorker({
    deps: { provider, store, rateLimiter },
    intervalMs,
    schedule: nativeScheduler(),
    immediate: true,
    onRun: (result, error) => {
      if (result === null) {
        healthState.recordCycle("ERROR");
        console.error("[odds-collector] cycle failed:", error);
        return;
      }
      healthState.recordCycle(result.status);
      console.log(`[odds-collector] ${result.status}`, {
        provider: result.provider,
        receivedAt: result.receivedAt,
        attempts: result.attempts,
        collect: result.collect,
        normalized: result.normalized.map(
          (entry) => `${entry.action}:${entry.canonicalEventId}@${entry.confidence.toFixed(2)}`
        ),
        detection: result.detection,
        error: result.error,
      });
    },
  });

  const healthServer = startHealthServer(healthState, () => worker.runCount());

  worker.start();

  const shutdown = (signal: string): void => {
    console.log(`[odds-collector] ${signal} received, stopping...`);
    healthServer.close();
    void worker.stop().then(() => process.exit(0));
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  // Run until a signal terminates the process.
  return await new Promise<never>(() => undefined);
}

const invokedDirectly =
  process.argv[1] !== undefined && process.argv[1].replace(/\\/g, "/").endsWith("main.ts");

if (invokedDirectly) {
  void main();
}
