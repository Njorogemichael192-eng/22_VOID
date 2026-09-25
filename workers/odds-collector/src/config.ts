import { type OddsApiProviderConfig } from "@22void/provider-contracts";
import { URL } from "node:url";

export type WorkerEnvironment = Readonly<Record<string, string | undefined>>;

export type ResolvedProviderConfig =
  { readonly kind: "mock" } | { readonly kind: "odds-api"; readonly config: OddsApiProviderConfig };

export type ResolvedStoreConfig =
  { readonly kind: "postgres"; readonly databaseUrl: string } | { readonly kind: "memory" };

export interface ResolvedWorkerConfig {
  readonly provider: ResolvedProviderConfig;
  readonly store: ResolvedStoreConfig;
}

export interface ResolvedHealthConfig {
  readonly startupGraceMs: number;
  readonly staleAfterMs: number;
}

export const DEFAULT_WORKER_STARTUP_GRACE_MS = 30_000;
export const DEFAULT_WORKER_STALENESS_MS = 300_000;
export const DEFAULT_WORKER_STALE_THRESHOLD_MS = DEFAULT_WORKER_STALENESS_MS;

export function isProductionEnvironment(env: WorkerEnvironment = process.env): boolean {
  return env.NODE_ENV === "production";
}

function invalidConfig(name: string, expectation: string): never {
  throw new Error(`Invalid ${name}: expected ${expectation}`);
}

function hasText(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== "";
}

function optionalProviderValue(
  env: WorkerEnvironment,
  name: string,
  production: boolean
): string | undefined {
  const raw = env[name];
  if (raw === undefined) return undefined;
  const value = raw.trim();
  if (value === "") {
    if (production) invalidConfig(name, "a non-empty value");
    return undefined;
  }
  return value;
}

function resolveBaseUrl(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const value = raw.trim();
  if (value === "") invalidConfig("ODDS_API_BASE_URL", "a non-empty URL");

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return invalidConfig("ODDS_API_BASE_URL", "a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    invalidConfig("ODDS_API_BASE_URL", "an http or https URL");
  }
  if (parsed.hostname === "") invalidConfig("ODDS_API_BASE_URL", "a URL with a host");
  return value;
}

export function resolveProviderConfig(
  env: WorkerEnvironment = process.env
): ResolvedProviderConfig {
  const production = isProductionEnvironment(env);
  const configuredProvider = env.WORKER_PROVIDER;

  if (production && !hasText(configuredProvider)) {
    invalidConfig("WORKER_PROVIDER", "mock or odds-api");
  }
  if (production && configuredProvider !== "mock" && configuredProvider !== "odds-api") {
    throw new Error(`Unknown WORKER_PROVIDER=${configuredProvider ?? ""}`);
  }

  const providerKind = configuredProvider ?? "mock";
  if (providerKind !== "odds-api") return { kind: "mock" };

  const apiKey = env.ODDS_API_KEY?.trim();
  if (apiKey === undefined || apiKey === "") {
    throw new Error("WORKER_PROVIDER=odds-api requires a non-empty ODDS_API_KEY");
  }

  const baseUrl = resolveBaseUrl(env.ODDS_API_BASE_URL);
  const regions = optionalProviderValue(env, "ODDS_API_REGIONS", production);
  const markets = optionalProviderValue(env, "ODDS_API_MARKETS", production);
  const defaultSportKey = optionalProviderValue(env, "ODDS_API_SPORT", production);
  const config: OddsApiProviderConfig = {
    apiKey,
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(regions === undefined ? {} : { regions }),
    ...(markets === undefined ? {} : { markets }),
    ...(defaultSportKey === undefined ? {} : { defaultSportKey }),
  };

  return { kind: "odds-api", config };
}

export function resolveStoreConfig(env: WorkerEnvironment = process.env): ResolvedStoreConfig {
  const production = isProductionEnvironment(env);
  const databaseUrl = env.DATABASE_URL?.trim();
  if (databaseUrl !== undefined && databaseUrl !== "") {
    return { kind: "postgres", databaseUrl };
  }
  if (production) invalidConfig("DATABASE_URL", "a non-empty connection string");
  return { kind: "memory" };
}

export function resolveWorkerConfig(env: WorkerEnvironment = process.env): ResolvedWorkerConfig {
  return {
    provider: resolveProviderConfig(env),
    store: resolveStoreConfig(env),
  };
}

function readDuration(
  env: WorkerEnvironment,
  names: readonly string[],
  fallback: number,
  allowZero: boolean
): number {
  for (const name of names) {
    const raw = env[name];
    if (raw === undefined) continue;
    if (raw.trim() === "")
      invalidConfig(name, allowZero ? "a non-negative number" : "a positive number");
    const value = Number(raw);
    if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
      invalidConfig(name, allowZero ? "a non-negative number" : "a positive number");
    }
    return value;
  }
  return fallback;
}

export function resolveHealthConfig(env: WorkerEnvironment = process.env): ResolvedHealthConfig {
  return {
    startupGraceMs: readDuration(
      env,
      ["WORKER_STARTUP_GRACE_MS", "WORKER_HEALTH_STARTUP_GRACE_MS"],
      DEFAULT_WORKER_STARTUP_GRACE_MS,
      true
    ),
    staleAfterMs: readDuration(
      env,
      [
        "WORKER_STALENESS_MS",
        "WORKER_STALE_THRESHOLD_MS",
        "WORKER_CYCLE_STALE_MS",
        "WORKER_HEALTH_STALE_THRESHOLD_MS",
        "WORKER_HEALTH_STALE_MS",
      ],
      DEFAULT_WORKER_STALE_THRESHOLD_MS,
      false
    ),
  };
}
