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
 */

import "dotenv/config";

import { MockProvider, OddsApiProvider, type OddsApiProviderConfig } from "@22void/provider-contracts";
import { createPrismaClient } from "@22void/db";

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

function resolveProvider(): MockProvider | OddsApiProvider {
  const providerKind = process.env.WORKER_PROVIDER ?? "mock";
  if (providerKind === "odds-api") {
    const apiKey = process.env.ODDS_API_KEY;
    if (apiKey === undefined || apiKey === "") {
      throw new Error("WORKER_PROVIDER=odds-api requires ODDS_API_KEY");
    }
    const config: OddsApiProviderConfig = {
      apiKey,
      ...(process.env.ODDS_API_BASE_URL !== undefined
        ? { baseUrl: process.env.ODDS_API_BASE_URL }
        : {}),
      ...(process.env.ODDS_API_REGIONS !== undefined
        ? { regions: process.env.ODDS_API_REGIONS }
        : {}),
      ...(process.env.ODDS_API_MARKETS !== undefined
        ? { markets: process.env.ODDS_API_MARKETS }
        : {}),
      ...(process.env.ODDS_API_SPORT !== undefined
        ? { defaultSportKey: process.env.ODDS_API_SPORT }
        : {}),
    };
    return new OddsApiProvider(config);
  }
  return new MockProvider();
}

function resolveStore() {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl !== undefined && databaseUrl !== "") {
    const db = createPrismaClient(databaseUrl);
    return { store: createDbWorkerStore(db), label: "postgres" };
  }
  console.warn("[odds-collector] DATABASE_URL unset — using the in-memory store (nothing persists).");
  return { store: createMemoryWorkerStore(), label: "memory" };
}

async function main(): Promise<void> {
  const provider = resolveProvider();
  const { store, label } = resolveStore();
  const intervalMs = numberEnv("SCANNER_POLL_INTERVAL_MS", 15_000);
  const capacity = numberEnv("RATE_LIMIT_CAPACITY", 10);
  const refillPerSecond = numberEnv("RATE_LIMIT_REFILL_PER_SECOND", 5);
  const rateLimiter = new TokenBucketRateLimiter({ capacity, refillPerSecond });

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
        console.error("[odds-collector] cycle failed:", error);
        return;
      }
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

  worker.start();

  const shutdown = (signal: string): void => {
    console.log(`[odds-collector] ${signal} received, stopping...`);
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