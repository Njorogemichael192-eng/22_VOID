/**
 * `/api/v1/ready` is unauthenticated and its real probe builds a Prisma client
 * per call, so the result must be memoised. These tests drive the module with a
 * mocked `@22void/db` so the default (non-injected) probe path is exercised.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const checkDbHealth = vi.fn(async () => ({ reachable: true, latencyMs: 1 }));

vi.mock("@22void/db", () => ({
  checkDbHealth: (...args: unknown[]) => checkDbHealth(...(args as [])),
}));

const URL_A = "postgresql://user:pass@db.internal:5432/void";
const URL_B = "postgresql://user:pass@other.internal:5432/void";

type ReadyModule = typeof import("./handlers/system.js");

let mod: ReadyModule;
let at = 1_000_000;

beforeEach(async () => {
  vi.resetModules();
  checkDbHealth.mockClear();
  checkDbHealth.mockResolvedValue({ reachable: true, latencyMs: 1 });
  mod = await import("./handlers/system.js");
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
    checkDbHealth.mockResolvedValue({ reachable: false });
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
        }),
    );

    const pending = Promise.all([
      mod.ready({ databaseUrl: URL_A, now: () => at }),
      mod.ready({ databaseUrl: URL_A, now: () => at }),
      mod.ready({ databaseUrl: URL_A, now: () => at }),
    ]);
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
