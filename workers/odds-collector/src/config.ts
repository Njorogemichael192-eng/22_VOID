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

/** Query parameters that would carry a credential in the URL. */
const CREDENTIAL_QUERY_PARAM = /^(api[-_]?key|key|token|access[-_]?token|password|secret|sig|signature)$/i;

function resolveBaseUrl(raw: string | undefined, production: boolean): string | undefined {
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

  // A production provider URL carries a live API key on every request, so the
  // transport has to be encrypted. `http://` is accepted outside production for
  // a local stub, which is the only place it is ever legitimate.
  if (production && parsed.protocol !== "https:") {
    invalidConfig(
      "ODDS_API_BASE_URL",
      "an https:// URL in production (the provider key is sent on every request; " +
        "http:// is only allowed outside production, e.g. a local test stub)"
    );
  }

  // Embedded userinfo is a credential in the URL by another name, and survives
  // in logs, .env files and process listings. Never legitimate.
  if (parsed.username !== "" || parsed.password !== "") {
    invalidConfig("ODDS_API_BASE_URL", "a URL without embedded credentials (no user:password@)");
  }

  // A key smuggled into the base URL's query string would defeat header auth
  // entirely, so refuse it rather than let the two mechanisms coexist silently.
  for (const name of parsed.searchParams.keys()) {
    if (CREDENTIAL_QUERY_PARAM.test(name)) {
      invalidConfig(
        "ODDS_API_BASE_URL",
        "a URL without a credential query parameter; pass the key via ODDS_API_KEY instead"
      );
    }
  }

  return value;
}

/**
 * Opt-in that permits the mock provider under `NODE_ENV=production`.
 *
 * Named at length on purpose. The only defensible reason to set it is a demo or
 * a smoke test that wants a production-shaped stack (real Postgres, real
 * migrations) without spending provider quota — and a flag that expensive to
 * type, greppable in an env file, and visible in the startup log is the point.
 */
export const ALLOW_MOCK_PROVIDER_ENV = "ALLOW_MOCK_PROVIDER_IN_PRODUCTION";

function mockProviderAllowed(env: WorkerEnvironment): boolean {
  return (env[ALLOW_MOCK_PROVIDER_ENV] ?? "").trim().toLowerCase() === "true";
}

export function resolveProviderConfig(
  env: WorkerEnvironment = process.env
): ResolvedProviderConfig {
  const production = isProductionEnvironment(env);
  const configuredProvider = env.WORKER_PROVIDER;

  if (production && !hasText(configuredProvider)) {
    // The default is `mock`, and production requires an explicit choice precisely
    // because that default fabricates data.
    invalidConfig("WORKER_PROVIDER", "odds-api (the mock provider is refused in production)");
  }
  if (configuredProvider !== undefined && configuredProvider !== "mock" && configuredProvider !== "odds-api") {
    throw new Error(`Unknown WORKER_PROVIDER=${configuredProvider}`);
  }

  const providerKind = configuredProvider ?? "mock";
  if (providerKind !== "odds-api") {
    if (production && !mockProviderAllowed(env)) {
      // The damaging combination is mock + production + DATABASE_URL: the store
      // resolves to postgres, so synthetic odds are persisted and then read back
      // and served as genuine opportunities. Nothing about that state looks wrong
      // from the outside - the cycles succeed and the worker reports healthy.
      throw new Error(
        "Refusing to run WORKER_PROVIDER=mock in production: it fabricates odds, and with " +
          "DATABASE_URL set those synthetic rows are persisted and served as real opportunities. " +
          "Set WORKER_PROVIDER=odds-api, or set " +
          `${ALLOW_MOCK_PROVIDER_ENV}=true if this is deliberately a demo.`
      );
    }
    return { kind: "mock" };
  }

  const apiKey = env.ODDS_API_KEY?.trim();
  if (apiKey === undefined || apiKey === "") {
    throw new Error("WORKER_PROVIDER=odds-api requires a non-empty ODDS_API_KEY");
  }

  const baseUrl = resolveBaseUrl(env.ODDS_API_BASE_URL, production);
  const regions = optionalProviderValue(env, "ODDS_API_REGIONS", production);
  const markets = optionalProviderValue(env, "ODDS_API_MARKETS", production);
  const defaultSportKey = optionalProviderValue(env, "ODDS_API_SPORT", production);
  // Off by default: a credential in the query string is copied into every proxy
  // and CDN access log on the path. Only for a provider that rejects the
  // `x-api-key` header the adapter now sends.
  const authInQuery = (env.ODDS_API_AUTH_IN_QUERY ?? "").trim().toLowerCase() === "true";
  const config: OddsApiProviderConfig = {
    apiKey,
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(regions === undefined ? {} : { regions }),
    ...(markets === undefined ? {} : { markets }),
    ...(defaultSportKey === undefined ? {} : { defaultSportKey }),
    ...(authInQuery ? { authInQuery } : {}),
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
