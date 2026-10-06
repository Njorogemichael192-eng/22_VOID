import {
  type OddsApiProviderConfig,
  type ParlayApiProviderConfig,
} from "@22void/provider-contracts";
import { URL } from "node:url";

export type WorkerEnvironment = Readonly<Record<string, string | undefined>>;

export type ResolvedProviderConfig =
  | { readonly kind: "mock" }
  | { readonly kind: "odds-api"; readonly config: OddsApiProviderConfig }
  | { readonly kind: "parlay-api"; readonly config: ParlayApiProviderConfig };

/** Provider names `WORKER_PROVIDER` accepts, in the order they are documented. */
export const PROVIDER_NAMES = ["mock", "odds-api", "parlay-api"] as const;

export type ResolvedStoreConfig =
  { readonly kind: "postgres"; readonly databaseUrl: string } | { readonly kind: "memory" };

export interface ResolvedWorkerConfig {
  /**
   * Every provider configured for this worker, in the order listed. A single
   * provider is the common case and yields a one-element list; the list form is
   * what makes `WORKER_PROVIDER=odds-api,parlay-api` and Provider C a
   * configuration change rather than a runtime change.
   */
  readonly providers: readonly ResolvedProviderConfig[];
  readonly store: ResolvedStoreConfig;
}

export interface ResolvedHealthConfig {
  readonly startupGraceMs: number;
  readonly staleAfterMs: number;
}

export const DEFAULT_WORKER_STARTUP_GRACE_MS = 30_000;
export const DEFAULT_WORKER_STALENESS_MS = 300_000;
export const DEFAULT_WORKER_STALE_THRESHOLD_MS = DEFAULT_WORKER_STALENESS_MS;
export const DEFAULT_SCANNER_POLL_INTERVAL_MS = 15_000;

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
const CREDENTIAL_QUERY_PARAM =
  /^(api[-_]?key|key|token|access[-_]?token|password|secret|sig|signature)$/i;

function resolveBaseUrl(
  name: string,
  raw: string | undefined,
  production: boolean
): string | undefined {
  if (raw === undefined) return undefined;
  const value = raw.trim();
  if (value === "") invalidConfig(name, "a non-empty URL");

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return invalidConfig(name, "a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    invalidConfig(name, "an http or https URL");
  }

  // A production provider URL carries a live API key on every request, so the
  // transport has to be encrypted. `http://` is accepted outside production for
  // a local stub, which is the only place it is ever legitimate.
  if (production && parsed.protocol !== "https:") {
    invalidConfig(
      name,
      "an https:// URL in production (the provider key is sent on every request; " +
        "http:// is only allowed outside production, e.g. a local test stub)"
    );
  }

  // Embedded userinfo is a credential in the URL by another name, and survives
  // in logs, .env files and process listings. Never legitimate.
  if (parsed.username !== "" || parsed.password !== "") {
    invalidConfig(name, "a URL without embedded credentials (no user:password@)");
  }

  // A key smuggled into the base URL's query string would defeat header auth
  // entirely, so refuse it rather than let the two mechanisms coexist silently.
  for (const param of parsed.searchParams.keys()) {
    if (CREDENTIAL_QUERY_PARAM.test(param)) {
      invalidConfig(
        name,
        `a URL without a credential query parameter; pass the key via ${name.replace(
          "_BASE_URL",
          "_KEY"
        )} instead`
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

/**
 * Resolve every provider `WORKER_PROVIDER` names, in list order.
 *
 * The value is a comma-separated list (`odds-api` or `odds-api,parlay-api`)
 * because Phase 19 is multi-provider: one cycle polls all of them and detection
 * runs once over the combined prices, which is the only way a cross-provider
 * arbitrage can be found. A single name is the common case and yields a
 * one-element list, so nothing about the shape changes when just one is set.
 */
export function resolveProviderConfigs(
  env: WorkerEnvironment = process.env
): readonly ResolvedProviderConfig[] {
  const production = isProductionEnvironment(env);
  const raw = env.WORKER_PROVIDER;

  if (production && !hasText(raw)) {
    // The default is `mock`, and production requires an explicit choice precisely
    // because that default fabricates data.
    invalidConfig(
      "WORKER_PROVIDER",
      "odds-api and/or parlay-api, comma-separated (the mock provider is refused in production)"
    );
  }

  const names = (raw ?? "mock").split(",").map((part) => part.trim());

  for (const name of names) {
    if (name === "") {
      // Dropping an empty segment would poll fewer providers than the operator
      // asked for while still reporting a healthy cycle - a silently narrowed
      // request is the same defect class as a knob that does nothing.
      invalidConfig(
        "WORKER_PROVIDER",
        `a comma-separated list with no empty entries, e.g. "odds-api" or "odds-api,parlay-api" (got ${JSON.stringify(raw)})`
      );
    }
  }

  const unknown = names.find((name) => !(PROVIDER_NAMES as readonly string[]).includes(name));
  if (unknown !== undefined) {
    throw new Error(
      `Unknown WORKER_PROVIDER=${unknown}; expected one of: ${PROVIDER_NAMES.join(", ")}`
    );
  }

  if (new Set(names).size !== names.length) {
    throw new Error(
      `Duplicate provider in WORKER_PROVIDER=${raw}: each may be listed once. ` +
        "A repeat polls the same feed twice in one cycle and spends its quota twice."
    );
  }

  if (names.length > 1 && names.includes("mock")) {
    throw new Error(
      `Invalid WORKER_PROVIDER=${raw}: mock cannot be combined with a real provider. ` +
        "Its prices are fabricated, so mixing it with a live feed would place invented " +
        "odds beside real ones in a single detection pass and report arbitrage that " +
        "does not exist."
    );
  }

  if (production && names[0] === "mock" && !mockProviderAllowed(env)) {
    // The damaging combination is mock + production + DATABASE_URL: the store
    // resolves to postgres, so synthetic odds are persisted and then read back
    // and served as genuine opportunities. Nothing about that state looks wrong
    // from the outside - the cycles succeed and the worker reports healthy.
    throw new Error(
      "Refusing to run WORKER_PROVIDER=mock in production: it fabricates odds, and with " +
        "DATABASE_URL set those synthetic rows are persisted and served as real opportunities. " +
        "Set WORKER_PROVIDER to a real provider (odds-api, parlay-api), or set " +
        `${ALLOW_MOCK_PROVIDER_ENV}=true if this is deliberately a demo.`
    );
  }

  return names.map((name) => resolveOneProvider(name, env, production));
}

function resolveOneProvider(
  name: string,
  env: WorkerEnvironment,
  production: boolean
): ResolvedProviderConfig {
  if (name === "mock") return { kind: "mock" };
  if (name === "odds-api") return resolveOddsApiProvider(env, production);
  return resolveParlayApiProvider(env, production);
}

function resolveOddsApiProvider(
  env: WorkerEnvironment,
  production: boolean
): Extract<ResolvedProviderConfig, { kind: "odds-api" }> {
  const apiKey = env.ODDS_API_KEY?.trim();
  if (apiKey === undefined || apiKey === "") {
    throw new Error("WORKER_PROVIDER=odds-api requires a non-empty ODDS_API_KEY");
  }

  const baseUrl = resolveBaseUrl("ODDS_API_BASE_URL", env.ODDS_API_BASE_URL, production);
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

function resolveParlayApiProvider(
  env: WorkerEnvironment,
  production: boolean
): Extract<ResolvedProviderConfig, { kind: "parlay-api" }> {
  const apiKey = env.PARLAY_API_KEY?.trim();
  if (apiKey === undefined || apiKey === "") {
    throw new Error("WORKER_PROVIDER=parlay-api requires a non-empty PARLAY_API_KEY");
  }

  const baseUrl = resolveBaseUrl("PARLAY_API_BASE_URL", env.PARLAY_API_BASE_URL, production);
  const regions = optionalProviderValue(env, "PARLAY_API_REGIONS", production);
  const markets = optionalProviderValue(env, "PARLAY_API_MARKETS", production);
  const defaultSportKey = optionalProviderValue(env, "PARLAY_API_SPORT", production);
  const config: ParlayApiProviderConfig = {
    apiKey,
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(regions === undefined ? {} : { regions }),
    ...(markets === undefined ? {} : { markets }),
    ...(defaultSportKey === undefined ? {} : { defaultSportKey }),
  };

  return { kind: "parlay-api", config };
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
    providers: resolveProviderConfigs(env),
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

export function resolveScanIntervalMs(env: WorkerEnvironment = process.env): number {
  return readDuration(env, ["SCANNER_POLL_INTERVAL_MS"], DEFAULT_SCANNER_POLL_INTERVAL_MS, false);
}

/**
 * The poll interval and the health staleness ceiling are not independent knobs.
 *
 * `staleAfterMs` is a freshness assertion, not a timeout: `/healthz` compares it
 * against the age of the last *completed* cycle (`health.ts`), answers 503, and
 * Docker marks the container unhealthy for anything longer. The scheduler waits
 * `intervalMs` between cycles, so an interval above the ceiling guarantees the
 * worker is stale for the entire gap between polls - permanently unhealthy while
 * behaving exactly as configured. `restart: unless-stopped` restarts on exit, not
 * on health, so nothing self-corrects it and the container simply sits there red.
 *
 * The failure is silent and expensive to diagnose after the fact (the logs show
 * healthy cycles and the dashboard shows fresh data), and it is trivially caused
 * by the legitimate act of raising the interval to conserve provider quota. So
 * it is refused at startup instead, naming both values.
 *
 * A margin is not required - the guard is a strict `>` - but equal values are a
 * knife edge: any scheduling jitter puts the cycle just over the line. Callers
 * should leave comfortable headroom (2x is reasonable).
 */
export function assertIntervalWithinStaleness(input: {
  intervalMs: number;
  staleAfterMs: number;
}): void {
  if (input.intervalMs <= input.staleAfterMs) return;
  throw new Error(
    `Invalid SCANNER_POLL_INTERVAL_MS/WORKER_STALENESS_MS: ` +
      `SCANNER_POLL_INTERVAL_MS=${input.intervalMs} exceeds ` +
      `WORKER_STALENESS_MS=${input.staleAfterMs}. The worker reports itself ` +
      `stale (and therefore unhealthy) once the last completed cycle is older ` +
      `than WORKER_STALENESS_MS, and a poll interval above that ceiling means ` +
      `it is stale for the whole gap between every poll. Raise ` +
      `WORKER_STALENESS_MS above SCANNER_POLL_INTERVAL_MS (2x is a reasonable ` +
      `margin) or lower the poll interval.`
  );
}
