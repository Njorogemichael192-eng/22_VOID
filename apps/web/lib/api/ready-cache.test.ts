/**
 * `/api/v1/ready` is unauthenticated, so its result must be memoised: one probe
 * serves every caller for the cache window instead of one probe (and one
 * database connection) per request. These tests drive the module with a mocked
 * `@22void/db` so the default (non-injected) probe path is exercised.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as mod from "./handlers/system";

const checkDbHealth = vi.fn(async () => ({ reachable: true, latencyMs: 1 }));

vi.mock("@22void/db", () => ({
  checkDbHealth: (...args: unknown[]) => checkDbHealth(...(args as [])),
}));

const URL_A = "postgresql://user:pass@db.internal:5432/void";
const URL_B = "postgresql://user:pass@other.internal:5432/void";

let at = 1_000_000;

beforeEach(() => {
  checkDbHealth.mockClear();
  checkDbHealth.mockResolvedValue({ reachable: true, latencyMs: 1 });
  mod.resetReadinessCache();
  at = 1_000_000;
});

afterEach(() => {
  mod.resetReadinessCache();
});

describe("readiness probe memoisation", () => {
  it("probes once per TTL window instead of once per public request", async () => {
    const first = await mod.ready({ databaseUrl: URL_A, now: () => at });
    expect(first.status).toBe(200);
    expect(checkDbHealth).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 100; i += 1) {
      at += 10;
      const repeat = await mod.ready({ databaseUrl: URL_A, now: () => at });
      expect(repeat.status).toBe(200);
    }
    expect(checkDbHealth).toHaveBeenCalledTimes(1);
  });

  it("re-probes once the TTL expires", async () => {
    await mod.ready({ databaseUrl: URL_A, now: () => at });
    at += mod.READINESS_CACHE_TTL_MS + 1;
    await mod.ready({ databaseUrl: URL_A, now: () => at });
    expect(checkDbHealth).toHaveBeenCalledTimes(2);
  });

  it("caches failures too, so a down database is not hammered", async () => {
    checkDbHealth.mockResolvedValue({ reachable: false, latencyMs: 0 });
    const first = await mod.ready({ databaseUrl: URL_A, now: () => at });
    expect(first.status).toBe(503);

    for (let i = 0; i < 25; i += 1) {
      at += 10;
      const repeat = await mod.ready({ databaseUrl: URL_A, now: () => at });
      expect(repeat.status).toBe(503);
    }
    expect(checkDbHealth).toHaveBeenCalledTimes(1);
  });

  it("collapses concurrent probes for the same database into one", async () => {
    let release: (() => void) | undefined;
    checkDbHealth.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ reachable: true, latencyMs: 1 });
        })
    );

    const pending = Promise.all([
      mod.ready({ databaseUrl: URL_A, now: () => at }),
      mod.ready({ databaseUrl: URL_A, now: () => at }),
      mod.ready({ databaseUrl: URL_A, now: () => at }),
    ]);
    // The default probe resolves @22void/db through a dynamic import, so the
    // mock is not reached until a microtask later; releasing synchronously
    // would resolve nothing and the assertions below would race the probe.
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    release?.();

    const responses = await pending;
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(checkDbHealth).toHaveBeenCalledTimes(1);
  });

  it("keeps separate cache entries per database URL", async () => {
    await mod.ready({ databaseUrl: URL_A, now: () => at });
    await mod.ready({ databaseUrl: URL_B, now: () => at });
    expect(checkDbHealth).toHaveBeenCalledTimes(2);
  });

  it("passes a bounded timeout to the database probe", async () => {
    await mod.ready({ databaseUrl: URL_A, now: () => at });
    expect(checkDbHealth).toHaveBeenCalledWith(URL_A, {
      timeoutMs: mod.READINESS_PROBE_TIMEOUT_MS,
    });
  });
});
