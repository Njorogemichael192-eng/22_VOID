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
    expect(resolveWorkerConfig({ NODE_ENV: "development", WORKER_PROVIDER: "other" })).toEqual({
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

  it("resolves health thresholds from environment values", () => {
    expect(
      resolveHealthConfig({
        WORKER_STARTUP_GRACE_MS: "1000",
        WORKER_STALENESS_MS: "2500",
      })
    ).toEqual({ startupGraceMs: 1000, staleAfterMs: 2500 });
  });
});
