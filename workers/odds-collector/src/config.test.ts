import { describe, expect, it } from "vitest";

import {
  resolveHealthConfig,
  resolveProviderConfig,
  resolveStoreConfig,
  resolveWorkerConfig,
} from "./config.js";

const productionDatabaseUrl = "postgresql://worker:password@localhost:5432/void";

describe("worker configuration", () => {
  it("retains mock and memory defaults outside production", () => {
    expect(resolveWorkerConfig({ NODE_ENV: "development" })).toEqual({
      provider: { kind: "mock" },
      store: { kind: "memory" },
    });
    expect(resolveWorkerConfig({ NODE_ENV: "development", WORKER_PROVIDER: "mock" })).toEqual({
      provider: { kind: "mock" },
      store: { kind: "memory" },
    });
  });

  it("rejects an unknown provider in production", () => {
    expect(() =>
      resolveProviderConfig({
        NODE_ENV: "production",
        WORKER_PROVIDER: "other",
        DATABASE_URL: productionDatabaseUrl,
      })
    ).toThrow(/Unknown WORKER_PROVIDER/);
  });

  it("requires an explicit provider in production", () => {
    expect(() =>
      resolveProviderConfig({ NODE_ENV: "production", DATABASE_URL: productionDatabaseUrl })
    ).toThrow(/WORKER_PROVIDER/);
  });

  it("refuses the mock provider in production", () => {
    // The dangerous combination: mock + production + DATABASE_URL means synthetic
    // odds are persisted to the real database and served as real opportunities,
    // with every cycle reporting success.
    expect(() =>
      resolveProviderConfig({
        NODE_ENV: "production",
        WORKER_PROVIDER: "mock",
        DATABASE_URL: productionDatabaseUrl,
      })
    ).toThrow(/Refusing to run WORKER_PROVIDER=mock in production/);

    // Even with no store configured at all, a production worker must not invent data.
    expect(() =>
      resolveProviderConfig({ NODE_ENV: "production", WORKER_PROVIDER: "mock" })
    ).toThrow(/Refusing to run WORKER_PROVIDER=mock in production/);

    // The refusal must not be side-stepped by a value that merely mentions the
    // flag, and the message must name the opt-in so the fix is discoverable.
    for (const flag of ["", "1", "yes", "true-ish", "ALLOW_MOCK_PROVIDER_IN_PRODUCTION"]) {
      expect(() =>
        resolveProviderConfig({
          NODE_ENV: "production",
          WORKER_PROVIDER: "mock",
          ALLOW_MOCK_PROVIDER_IN_PRODUCTION: flag,
        })
      ).toThrow(/ALLOW_MOCK_PROVIDER_IN_PRODUCTION=true/);
    }
  });

  it("allows mock in production only through the explicit demo opt-in", () => {
    expect(
      resolveProviderConfig({
        NODE_ENV: "production",
        WORKER_PROVIDER: "mock",
        DATABASE_URL: productionDatabaseUrl,
        ALLOW_MOCK_PROVIDER_IN_PRODUCTION: "true",
      })
    ).toEqual({ kind: "mock" });

    // Case and surrounding whitespace should not decide whether a demo runs.
    expect(
      resolveProviderConfig({
        NODE_ENV: "production",
        WORKER_PROVIDER: "mock",
        ALLOW_MOCK_PROVIDER_IN_PRODUCTION: "  TRUE  ",
      })
    ).toEqual({ kind: "mock" });
  });

  it("keeps mock available outside production without the opt-in", () => {
    for (const nodeEnv of [undefined, "development", "test"]) {
      expect(resolveProviderConfig({ NODE_ENV: nodeEnv, WORKER_PROVIDER: "mock" })).toEqual({
        kind: "mock",
      });
    }
  });

  it("rejects an unknown provider outside production too", () => {
    // Previously `other` silently resolved to mock everywhere, which hid typos
    // in a developer's env file until the collector produced fake data.
    expect(() => resolveProviderConfig({ NODE_ENV: "development", WORKER_PROVIDER: "other" })).toThrow(
      /Unknown WORKER_PROVIDER=other/
    );
    expect(() => resolveProviderConfig({ NODE_ENV: "development", WORKER_PROVIDER: " ODDS-API " })).toThrow(
      /Unknown WORKER_PROVIDER/
    );
  });

  it("requires a database in production", () => {
    expect(() => resolveStoreConfig({ NODE_ENV: "production" })).toThrow(/DATABASE_URL/);
    expect(
      resolveStoreConfig({ NODE_ENV: "production", DATABASE_URL: productionDatabaseUrl })
    ).toEqual({
      kind: "postgres",
      databaseUrl: productionDatabaseUrl,
    });
  });

  it("requires a non-empty API key for the live provider", () => {
    expect(() =>
      resolveProviderConfig({ NODE_ENV: "production", WORKER_PROVIDER: "odds-api" })
    ).toThrow(/ODDS_API_KEY/);
  });

  it("does not pass an explicitly empty base URL to the adapter", () => {
    expect(() =>
      resolveProviderConfig({
        NODE_ENV: "production",
        WORKER_PROVIDER: "odds-api",
        ODDS_API_KEY: "key",
        ODDS_API_BASE_URL: "",
      })
    ).toThrow(/ODDS_API_BASE_URL/);
  });

  it("omits the base URL when the adapter default should be used", () => {
    expect(
      resolveProviderConfig({
        NODE_ENV: "production",
        WORKER_PROVIDER: "odds-api",
        ODDS_API_KEY: "key",
      })
    ).toEqual({ kind: "odds-api", config: { apiKey: "key" } });
  });

  it("keeps a valid production base URL override", () => {
    expect(
      resolveProviderConfig({
        NODE_ENV: "production",
        WORKER_PROVIDER: "odds-api",
        ODDS_API_KEY: "key",
        ODDS_API_BASE_URL: "https://provider.example.test",
      })
    ).toEqual({
      kind: "odds-api",
      config: { apiKey: "key", baseUrl: "https://provider.example.test" },
    });
  });

  it("requires https for the provider base URL in production", () => {
    expect(() =>
      resolveProviderConfig({
        NODE_ENV: "production",
        WORKER_PROVIDER: "odds-api",
        ODDS_API_KEY: "key",
        ODDS_API_BASE_URL: "http://provider.example.test",
      })
    ).toThrow(/ODDS_API_BASE_URL: expected an https:\/\/ URL in production/);
  });

  it("allows http outside production for a local stub", () => {
    expect(
      resolveProviderConfig({
        NODE_ENV: "development",
        WORKER_PROVIDER: "odds-api",
        ODDS_API_KEY: "key",
        ODDS_API_BASE_URL: "http://127.0.0.1:4010",
      })
    ).toEqual({
      kind: "odds-api",
      config: { apiKey: "key", baseUrl: "http://127.0.0.1:4010" },
    });
  });

  it("refuses credentials embedded in the provider URL", () => {
    for (const baseUrl of [
      "https://user:pass@provider.example.test",
      "https://key@provider.example.test",
    ]) {
      expect(() =>
        resolveProviderConfig({
          NODE_ENV: "production",
          WORKER_PROVIDER: "odds-api",
          ODDS_API_KEY: "key",
          ODDS_API_BASE_URL: baseUrl,
        })
      ).toThrow(/without embedded credentials/);
    }
  });

  it("refuses a credential smuggled into the provider URL's query string", () => {
    for (const query of ["apiKey", "apikey", "api_key", "token", "access_token", "key"]) {
      expect(() =>
        resolveProviderConfig({
          NODE_ENV: "production",
          WORKER_PROVIDER: "odds-api",
          ODDS_API_KEY: "key",
          ODDS_API_BASE_URL: `https://provider.example.test/v4?${query}=secret`,
        })
      ).toThrow(/without a credential query parameter/);
    }
  });

  it("rejects non-http schemes for the provider URL", () => {
    for (const baseUrl of ["ftp://provider.example.test", "file:///etc/passwd"]) {
      expect(() =>
        resolveProviderConfig({
          NODE_ENV: "production",
          WORKER_PROVIDER: "odds-api",
          ODDS_API_KEY: "key",
          ODDS_API_BASE_URL: baseUrl,
        })
      ).toThrow(/an http or https URL/);
    }
  });

  it("enables query auth only when explicitly requested", () => {
    const base = {
      NODE_ENV: "production",
      WORKER_PROVIDER: "odds-api",
      ODDS_API_KEY: "key",
    } as const;
    const resolved = resolveProviderConfig(base);
    expect(resolved.kind).toBe("odds-api");
    expect(Object.hasOwn(resolved.kind === "odds-api" ? resolved.config : {}, "authInQuery")).toBe(
      false
    );
    expect(resolveProviderConfig({ ...base, ODDS_API_AUTH_IN_QUERY: "true" })).toEqual({
      kind: "odds-api",
      config: { apiKey: "key", authInQuery: true },
    });
    for (const value of ["", "1", "yes", "false"]) {
      expect(resolveProviderConfig({ ...base, ODDS_API_AUTH_IN_QUERY: value })).toEqual({
        kind: "odds-api",
        config: { apiKey: "key" },
      });
    }
  });

  it("resolves health thresholds from environment values", () => {
    expect(
      resolveHealthConfig({
        WORKER_STARTUP_GRACE_MS: "1000",
        WORKER_STALENESS_MS: "2500",
      })
    ).toEqual({ startupGraceMs: 1000, staleAfterMs: 2500 });
  });
});
