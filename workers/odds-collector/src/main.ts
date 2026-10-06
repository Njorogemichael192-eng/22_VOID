/**
 * odds-collector entrypoint (Phase 14).
 *
 * Env-driven:
 *   WORKER_PROVIDER              comma list of providers, one cycle polls each
 *                                (default: mock; mock is REFUSED under
 *                                NODE_ENV=production and cannot be combined with
 *                                a real provider)
 *                                e.g. `odds-api` or `odds-api,parlay-api`
 *   ALLOW_MOCK_PROVIDER_IN_PRODUCTION  true                deliberate demo only; overrides the refusal
 *   ODDS_API_KEY / ODDS_API_BASE_URL             (odds-api provider)
 *   ODDS_API_REGIONS / ODDS_API_MARKETS / ODDS_API_SPORT   per-request selection
 *   PARLAY_API_KEY / PARLAY_API_BASE_URL         (parlay-api provider)
 *   PARLAY_API_REGIONS / PARLAY_API_MARKETS / PARLAY_API_SPORT
 *   DATABASE_URL                 when set, uses the Postgres store; otherwise in-memory
 *   SCANNER_POLL_INTERVAL_MS     cycle interval in ms (default 15000)
 *                                must not exceed WORKER_STALENESS_MS; refused at
 *                                startup otherwise (see config.ts)
 *   RATE_LIMIT_CAPACITY          token bucket size (default 10)
 *   RATE_LIMIT_REFILL_PER_SECOND refill rate (default 5)
 *   WORKER_HEALTH_PORT           liveness/metrics endpoint port (default 8081)
 *   WORKER_STALENESS_MS          age past which a cycle is "stale" (default 300000)
 */

import "dotenv/config";

import { MockProvider, OddsApiProvider, ParlayApiProvider } from "@22void/provider-contracts";
import { formatProviderQuota } from "@22void/provider-contracts";
import type { OddsProvider } from "@22void/provider-contracts";
import { createPrismaClient } from "@22void/db";

import {
  ALLOW_MOCK_PROVIDER_ENV,
  assertIntervalWithinStaleness,
  isProductionEnvironment,
  resolveHealthConfig,
  resolveScanIntervalMs,
  resolveWorkerConfig,
  type ResolvedProviderConfig,
  type ResolvedStoreConfig,
} from "./config.js";
import { createHealthServer, createWorkerHealthState, type WorkerHealthState } from "./health.js";
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

function createProvider(config: ResolvedProviderConfig): OddsProvider {
  if (config.kind === "odds-api") return new OddsApiProvider(config.config);
  if (config.kind === "parlay-api") return new ParlayApiProvider(config.config);
  return new MockProvider();
}

/**
 * Reaching this means the mock provider cleared the production gate, i.e.
 * `ALLOW_MOCK_PROVIDER_IN_PRODUCTION=true` — a deliberate demo, not an accident.
 * It still gets a banner, because the failure mode this whole guard exists for is
 * nobody noticing: the cycles succeed, health stays green, and the dashboard shows
 * tidy arbitrage that does not exist. The store label is in the banner on purpose
 * — synthetic odds landing in postgres are the case that matters.
 */
function warnOnSyntheticProductionData(
  providers: readonly ResolvedProviderConfig[],
  storeLabel: string
): void {
  if (!providers.some((provider) => provider.kind === "mock")) return;
  if (!isProductionEnvironment()) return;
  const width = 74;
  const line = (text: string): string => `  # ${text.padEnd(width - 4)}#`;
  console.warn(
    [
      "",
      `  #${"#".repeat(width)}`,
      line("PRODUCTION MODE IS SERVING SYNTHETIC ODDS"),
      line(""),
      line(`The mock provider is running under NODE_ENV=production because`),
      line(`${ALLOW_MOCK_PROVIDER_ENV}=true.`),
      line(`Every price, opportunity and arbitrage below is invented by`),
      line(`MockProvider, not a bookmaker. Store: ${storeLabel}.`),
      line(""),
      line("Never leave this set on a stack anyone reads as real data."),
      `  #${"#".repeat(width)}`,
      "",
    ].join("\n")
  );
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
  const server = createHealthServer({ state, getRunCount });

  // Without a listener, EADDRINUSE arrives as an uncaught 'error' event and
  // kills the process with an opaque stack. The health port is not optional:
  // a worker that cannot report on itself is a worker nothing can supervise, so
  // fail fast — but say why first.
  server.on("error", (error: unknown) => {
    console.error(`[odds-collector] health server failed to serve on :${port}:`, error);
    process.exit(1);
  });

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
  // Refused before anything is constructed or any provider call is made: an
  // interval above the staleness ceiling is a configuration error, and starting
  // up "successfully" into a permanently unhealthy container hides it.
  const intervalMs = resolveScanIntervalMs();
  assertIntervalWithinStaleness({
    intervalMs,
    staleAfterMs: healthConfig.staleAfterMs,
  });
  const providers = resolved.providers.map(createProvider);
  const { store, label } = createStore(resolved.store);
  warnOnSyntheticProductionData(resolved.providers, label);
  const capacity = numberEnv("RATE_LIMIT_CAPACITY", 10);
  const refillPerSecond = numberEnv("RATE_LIMIT_REFILL_PER_SECOND", 5);
  const rateLimiter = new TokenBucketRateLimiter({ capacity, refillPerSecond });
  const healthState = createWorkerHealthState({
    startedAt: processStartedAt,
    ...healthConfig,
  });

  // The configured list, not just the instances: a two-provider cycle spends two
  // provider quotas per poll, and the startup line is where that is meant to be
  // noticed.
  console.log(
    `[odds-collector] starting provider=${resolved.providers.map((p) => p.kind).join(",")} store=${label} intervalMs=${intervalMs} rate=${capacity}/${refillPerSecond}`
  );

  const worker = createScanWorker({
    deps: { providers, store, rateLimiter },
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
        sources: result.sources.map((source) => ({
          provider: source.provider,
          status: source.status,
          receivedAt: source.receivedAt,
          attempts: source.attempts,
          // Credit balance for this poll. `unreported` means the provider sent no
          // quota headers - which is expected for the mock provider and would be a
          // gap worth noticing for a metered one, because it means the budget is
          // invisible. `last` is the per-poll cost, so a change in markets or
          // regions shows up here as a change in the price of one poll.
          quota: formatProviderQuota(source.quota),
          collect: source.collect,
          error: source.error,
        })),
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
  main().catch((error: unknown) => {
    // A rejected startup (an invalid WORKER_STALENESS_MS, a bad port, an
    // unreachable database) would otherwise be an unhandled rejection: fatal in
    // Node 22, but silent in `docker compose logs`. This container's whole job
    // is to be restarted and watched, so the reason it died has to be in the log.
    console.error("[odds-collector] fatal error during startup:", error);
    process.exit(1);
  });
}
