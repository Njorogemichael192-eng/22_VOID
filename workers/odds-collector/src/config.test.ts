import { describe, expect, it } from "vitest";

import {
  DEFAULT_SCANNER_POLL_INTERVAL_MS,
  DEFAULT_WORKER_STALENESS_MS,
  assertIntervalWithinStaleness,
  resolveHealthConfig,
  resolveProviderConfigs,
  resolveScanIntervalMs,
  resolveStoreConfig,
  resolveWorkerConfig,
} from "./config.js";

const productionDatabaseUrl = "postgresql://worker:password@localhost:5432/void";
const liveProviderEnv = {
  NODE_ENV: "production",
  WORKER_PROVIDER: "odds-api",
  ODDS_API_KEY: "k".repeat(32),
  DATABASE_URL: productionDatabaseUrl,
} as const;

/**
 * Every case below configures exactly one provider, so unwrap the list once and
 * assert it is a single element - which also fails loudly if a fixture ever starts
 * resolving to more than the one provider it describes.
 */
function resolveSingleProvider(env: Parameters<typeof resolveProviderConfigs>[0]) {
  const resolved = resolveProviderConfigs(env);
  expect(resolved).toHaveLength(1);
  return resolved[0]!;
}

describe("worker configuration", () => {
  it("retains mock and memory defaults outside production", () => {
    expect(resolveWorkerConfig({ NODE_ENV: "development" })).toEqual({
      providers: [{ kind: "mock" }],
      store: { kind: "memory" },
    });
    expect(resolveWorkerConfig({ NODE_ENV: "development", WORKER_PROVIDER: "mock" })).toEqual({
      providers: [{ kind: "mock" }],
      store: { kind: "memory" },
    });
  });

  it("rejects an unknown provider in production", () => {
    expect(() =>
      resolveSingleProvider({
        NODE_ENV: "production",
        WORKER_PROVIDER: "other",
        DATABASE_URL: productionDatabaseUrl,
      })
    ).toThrow(/Unknown WORKER_PROVIDER/);
  });

  it("requires an explicit provider in production", () => {
    expect(() =>
      resolveSingleProvider({ NODE_ENV: "production", DATABASE_URL: productionDatabaseUrl })
    ).toThrow(/WORKER_PROVIDER/);
  });

  it("refuses the mock provider in production", () => {
    // The dangerous combination: mock + production + DATABASE_URL means synthetic
    // odds are persisted to the real database and served as real opportunities,
    // with every cycle reporting success.
    expect(() =>
      resolveSingleProvider({
        NODE_ENV: "production",
        WORKER_PROVIDER: "mock",
        DATABASE_URL: productionDatabaseUrl,
      })
    ).toThrow(/Refusing to run WORKER_PROVIDER=mock in production/);

    // Even with no store configured at all, a production worker must not invent data.
    expect(() =>
      resolveSingleProvider({ NODE_ENV: "production", WORKER_PROVIDER: "mock" })
    ).toThrow(/Refusing to run WORKER_PROVIDER=mock in production/);

    // The refusal must not be side-stepped by a value that merely mentions the
    // flag, and the message must name the opt-in so the fix is discoverable.
    for (const flag of ["", "1", "yes", "true-ish", "ALLOW_MOCK_PROVIDER_IN_PRODUCTION"]) {
      expect(() =>
        resolveSingleProvider({
          NODE_ENV: "production",
          WORKER_PROVIDER: "mock",
          ALLOW_MOCK_PROVIDER_IN_PRODUCTION: flag,
        })
      ).toThrow(/ALLOW_MOCK_PROVIDER_IN_PRODUCTION=true/);
    }
  });

  it("allows mock in production only through the explicit demo opt-in", () => {
    expect(
      resolveSingleProvider({
        NODE_ENV: "production",
        WORKER_PROVIDER: "mock",
        DATABASE_URL: productionDatabaseUrl,
        ALLOW_MOCK_PROVIDER_IN_PRODUCTION: "true",
      })
    ).toEqual({ kind: "mock" });

    // Case and surrounding whitespace should not decide whether a demo runs.
    expect(
      resolveSingleProvider({
        NODE_ENV: "production",
        WORKER_PROVIDER: "mock",
        ALLOW_MOCK_PROVIDER_IN_PRODUCTION: "  TRUE  ",
      })
    ).toEqual({ kind: "mock" });
  });

  it("keeps mock available outside production without the opt-in", () => {
    for (const nodeEnv of [undefined, "development", "test"]) {
      expect(resolveSingleProvider({ NODE_ENV: nodeEnv, WORKER_PROVIDER: "mock" })).toEqual({
        kind: "mock",
      });
    }
  });

  it("rejects an unknown provider outside production too", () => {
    // Previously `other` silently resolved to mock everywhere, which hid typos
    // in a developer's env file until the collector produced fake data.
    expect(() =>
      resolveSingleProvider({ NODE_ENV: "development", WORKER_PROVIDER: "other" })
    ).toThrow(/Unknown WORKER_PROVIDER=other/);
    expect(() =>
      resolveSingleProvider({ NODE_ENV: "development", WORKER_PROVIDER: " ODDS-API " })
    ).toThrow(/Unknown WORKER_PROVIDER/);
  });

  /**
   * One cycle polls every provider `WORKER_PROVIDER` names, so a malformed list
   * would narrow the request without any error being raised - and a cycle that
   * skips a configured provider reports itself healthy while leaving its feed
   * unseen.
   */
  describe("provider list", () => {
    it("resolves a comma-separated pair in the order listed", () => {
      expect(
        resolveProviderConfigs({
          NODE_ENV: "production",
          WORKER_PROVIDER: "odds-api,parlay-api",
          ODDS_API_KEY: "k".repeat(32),
          PARLAY_API_KEY: "p".repeat(32),
          DATABASE_URL: productionDatabaseUrl,
        })
      ).toEqual([
        { kind: "odds-api", config: { apiKey: "k".repeat(32) } },
        { kind: "parlay-api", config: { apiKey: "p".repeat(32) } },
      ]);
    });

    it("trims surrounding whitespace on each entry", () => {
      expect(
        resolveProviderConfigs({
          NODE_ENV: "development",
          WORKER_PROVIDER: "  parlay-api , odds-api ",
          ODDS_API_KEY: "k",
          PARLAY_API_KEY: "p",
        }).map((provider) => provider.kind)
      ).toEqual(["parlay-api", "odds-api"]);
    });

    it("rejects an empty entry rather than silently polling fewer providers", () => {
      // The half-written env line `WORKER_PROVIDER=odds-api,` must not resolve to
      // a single provider that then reports a complete cycle.
      for (const value of ["odds-api,", ",odds-api", "odds-api,,parlay-api", " "]) {
        expect(() =>
          resolveProviderConfigs({ NODE_ENV: "development", WORKER_PROVIDER: value })
        ).toThrow(/WORKER_PROVIDER/);
      }
    });

    it("rejects a duplicate rather than polling the same feed twice per cycle", () => {
      expect(() =>
        resolveProviderConfigs({ NODE_ENV: "development", WORKER_PROVIDER: "odds-api,odds-api" })
      ).toThrow(/Duplicate provider/);
    });

    it("refuses mock alongside a real provider", () => {
      // Fabricated prices beside real ones in one detection pass produce
      // arbitrage that does not exist, with no visible sign of the mixing.
      expect(() =>
        resolveProviderConfigs({
          NODE_ENV: "development",
          WORKER_PROVIDER: "odds-api,mock",
          ODDS_API_KEY: "k",
        })
      ).toThrow(/mock cannot be combined/);
      expect(() =>
        resolveProviderConfigs({
          NODE_ENV: "development",
          WORKER_PROVIDER: "mock,parlay-api",
          PARLAY_API_KEY: "p",
        })
      ).toThrow(/mock cannot be combined/);
    });

    it("names every accepted provider when rejecting an unknown one", () => {
      expect(() =>
        resolveProviderConfigs({
          NODE_ENV: "development",
          WORKER_PROVIDER: "odds-api,pinnacle",
          ODDS_API_KEY: "k",
        })
      ).toThrow(/Unknown WORKER_PROVIDER=pinnacle; expected one of: mock, odds-api, parlay-api/);
    });

    it("resolves parlay-api on its own key and base URL", () => {
      expect(
        resolveProviderConfigs({
          NODE_ENV: "development",
          WORKER_PROVIDER: "parlay-api",
          PARLAY_API_KEY: "p",
          PARLAY_API_BASE_URL: "https://parlay.example.test",
          PARLAY_API_REGIONS: "us",
          PARLAY_API_MARKETS: "h2h_3_way",
          PARLAY_API_SPORT: "soccer_epl",
        })
      ).toEqual([
        {
          kind: "parlay-api",
          config: {
            apiKey: "p",
            baseUrl: "https://parlay.example.test",
            regions: "us",
            markets: "h2h_3_way",
            defaultSportKey: "soccer_epl",
          },
        },
      ]);
    });

    it("requires a non-empty PARLAY_API_KEY when parlay-api is selected", () => {
      expect(() =>
        resolveProviderConfigs({ NODE_ENV: "development", WORKER_PROVIDER: "parlay-api" })
      ).toThrow(/PARLAY_API_KEY/);
      expect(() =>
        resolveProviderConfigs({
          NODE_ENV: "development",
          WORKER_PROVIDER: "parlay-api",
          PARLAY_API_KEY: "   ",
        })
      ).toThrow(/PARLAY_API_KEY/);
    });

    it("does not let a missing odds-api key survive a two-provider list", () => {
      // The second provider's failure must not be hidden by the first resolving.
      expect(() =>
        resolveProviderConfigs({
          NODE_ENV: "development",
          WORKER_PROVIDER: "parlay-api,odds-api",
          PARLAY_API_KEY: "p",
        })
      ).toThrow(/ODDS_API_KEY/);
    });
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
      resolveSingleProvider({ NODE_ENV: "production", WORKER_PROVIDER: "odds-api" })
    ).toThrow(/ODDS_API_KEY/);
  });

  it("does not pass an explicitly empty base URL to the adapter", () => {
    expect(() =>
      resolveSingleProvider({
        NODE_ENV: "production",
        WORKER_PROVIDER: "odds-api",
        ODDS_API_KEY: "key",
        ODDS_API_BASE_URL: "",
      })
    ).toThrow(/ODDS_API_BASE_URL/);
  });

  it("omits the base URL when the adapter default should be used", () => {
    expect(
      resolveSingleProvider({
        NODE_ENV: "production",
        WORKER_PROVIDER: "odds-api",
        ODDS_API_KEY: "key",
      })
    ).toEqual({ kind: "odds-api", config: { apiKey: "key" } });
  });

  it("keeps a valid production base URL override", () => {
    expect(
      resolveSingleProvider({
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
      resolveSingleProvider({
        NODE_ENV: "production",
        WORKER_PROVIDER: "odds-api",
        ODDS_API_KEY: "key",
        ODDS_API_BASE_URL: "http://provider.example.test",
      })
    ).toThrow(/ODDS_API_BASE_URL: expected an https:\/\/ URL in production/);
  });

  it("allows http outside production for a local stub", () => {
    expect(
      resolveSingleProvider({
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
        resolveSingleProvider({
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
        resolveSingleProvider({
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
        resolveSingleProvider({
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
    const resolved = resolveSingleProvider(base);
    expect(resolved.kind).toBe("odds-api");
    expect(Object.hasOwn(resolved.kind === "odds-api" ? resolved.config : {}, "authInQuery")).toBe(
      false
    );
    expect(resolveSingleProvider({ ...base, ODDS_API_AUTH_IN_QUERY: "true" })).toEqual({
      kind: "odds-api",
      config: { apiKey: "key", authInQuery: true },
    });
    for (const value of ["", "1", "yes", "false"]) {
      expect(resolveSingleProvider({ ...base, ODDS_API_AUTH_IN_QUERY: value })).toEqual({
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

/**
 * Regions, markets and sport determine the credit cost of every poll
 * (cost = markets x regions), so a knob that silently does nothing is a billing
 * defect, not a cosmetic one. These pin that the resolver actually honours them.
 */
describe("provider request selection", () => {
  it("defaults to no request selection, deferring to the adapter", () => {
    // Unset must stay unset rather than being defaulted here: the adapter owns
    // these defaults, and duplicating them in config would let the two drift.
    expect(resolveSingleProvider(liveProviderEnv)).toEqual({
      kind: "odds-api",
      config: { apiKey: "k".repeat(32) },
    });
  });

  it("honours ODDS_API_MARKETS, ODDS_API_REGIONS and ODDS_API_SPORT", () => {
    const resolved = resolveSingleProvider({
      ...liveProviderEnv,
      ODDS_API_MARKETS: "h2h",
      ODDS_API_REGIONS: "uk",
      ODDS_API_SPORT: "soccer_spain_la_liga",
    });
    expect(resolved).toEqual({
      kind: "odds-api",
      config: {
        apiKey: "k".repeat(32),
        markets: "h2h",
        regions: "uk",
        defaultSportKey: "soccer_spain_la_liga",
      },
    });
  });

  it("passes multi-value comma lists through verbatim", () => {
    // No sorting or de-duplication: the provider charges per region asked for, so
    // rewriting the list here would change the bill in a way the operator did not
    // ask for.
    const resolved = resolveSingleProvider({
      ...liveProviderEnv,
      ODDS_API_REGIONS: "uk,eu,au",
      ODDS_API_MARKETS: "h2h,spreads,totals",
    });
    expect(resolved).toMatchObject({
      config: { regions: "uk,eu,au", markets: "h2h,spreads,totals" },
    });
  });

  it("rejects an empty request selection in production", () => {
    // Empty is how a commented-out or half-written env line usually arrives.
    // Silently treating it as "unset" would bill the adapter defaults while the
    // operator believed they had narrowed the request.
    expect(() => resolveSingleProvider({ ...liveProviderEnv, ODDS_API_MARKETS: "" })).toThrow(
      /ODDS_API_MARKETS/
    );
    expect(() => resolveSingleProvider({ ...liveProviderEnv, ODDS_API_REGIONS: "" })).toThrow(
      /ODDS_API_REGIONS/
    );
    expect(() => resolveSingleProvider({ ...liveProviderEnv, ODDS_API_SPORT: "" })).toThrow(
      /ODDS_API_SPORT/
    );
  });
});

/**
 * The poll interval and the health staleness ceiling are one setting. Raising the
 * interval to conserve provider quota is a legitimate, expected operation - and
 * without this guard it produces a container that is permanently unhealthy while
 * every log line says the worker is fine.
 */
describe("poll interval vs health staleness", () => {
  it("defaults the interval and the ceiling to their documented values", () => {
    expect(resolveScanIntervalMs({})).toBe(DEFAULT_SCANNER_POLL_INTERVAL_MS);
    expect(resolveScanIntervalMs({})).toBe(15_000);
    expect(resolveHealthConfig({}).staleAfterMs).toBe(DEFAULT_WORKER_STALENESS_MS);
    expect(resolveHealthConfig({}).staleAfterMs).toBe(300_000);
  });

  it("accepts the shipped defaults, which are interval < ceiling", () => {
    expect(() =>
      assertIntervalWithinStaleness({
        intervalMs: resolveScanIntervalMs({}),
        staleAfterMs: resolveHealthConfig({}).staleAfterMs,
      })
    ).not.toThrow();
  });

  it("refuses the shipped quota-safe pair from the runbook", () => {
    // 90 min interval with a 3 h ceiling is the documented 7-day-free-quota
    // configuration. It must start.
    expect(() =>
      assertIntervalWithinStaleness({ intervalMs: 5_400_000, staleAfterMs: 10_800_000 })
    ).not.toThrow();
  });

  it("refuses an interval above the ceiling and names both values", () => {
    expect(() =>
      assertIntervalWithinStaleness({
        intervalMs: 99_999_999,
        staleAfterMs: DEFAULT_WORKER_STALENESS_MS,
      })
    ).toThrow(/SCANNER_POLL_INTERVAL_MS=99999999 exceeds WORKER_STALENESS_MS=300000/);
  });

  it("explains the consequence rather than just the mismatch", () => {
    // The message is the only thing an operator sees at 3am; it has to say why.
    expect(() =>
      assertIntervalWithinStaleness({ intervalMs: 99_999_999, staleAfterMs: 300_000 })
    ).toThrow(/stale/i);
    expect(() =>
      assertIntervalWithinStaleness({ intervalMs: 99_999_999, staleAfterMs: 300_000 })
    ).toThrow(/Raise WORKER_STALENESS_MS above SCANNER_POLL_INTERVAL_MS/);
  });

  it("allows equality, since only a strictly greater interval is incoherent", () => {
    expect(() =>
      assertIntervalWithinStaleness({ intervalMs: 300_000, staleAfterMs: 300_000 })
    ).not.toThrow();
  });

  it("allows an interval below the ceiling", () => {
    expect(() =>
      assertIntervalWithinStaleness({ intervalMs: 60_000, staleAfterMs: 300_000 })
    ).not.toThrow();
  });

  it("rejects a malformed interval", () => {
    expect(() => resolveScanIntervalMs({ SCANNER_POLL_INTERVAL_MS: "0" })).toThrow(
      /SCANNER_POLL_INTERVAL_MS/
    );
    expect(() => resolveScanIntervalMs({ SCANNER_POLL_INTERVAL_MS: "-5" })).toThrow(
      /SCANNER_POLL_INTERVAL_MS/
    );
    expect(() => resolveScanIntervalMs({ SCANNER_POLL_INTERVAL_MS: "" })).toThrow(
      /SCANNER_POLL_INTERVAL_MS/
    );
    expect(() => resolveScanIntervalMs({ SCANNER_POLL_INTERVAL_MS: "soon" })).toThrow(
      /SCANNER_POLL_INTERVAL_MS/
    );
  });
});
