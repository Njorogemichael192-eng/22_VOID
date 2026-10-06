import {
  MockProvider,
  ProviderTransportError,
  type OddsProvider,
  type PollResult,
  type ProviderQuota,
} from "@22void/provider-contracts";
import { describe, expect, it } from "vitest";

import { defaultRetryPolicy } from "./retry.js";
import { createScanWorker, nativeScheduler, runScanCycle } from "./runtime.js";
import { createMemoryWorkerStore } from "./store.js";

const NOW = "2026-09-21T12:00:00.000Z";

/** Provider that fails with a transient error `failuresLeft` times, then succeeds. */
class FlakyProvider implements OddsProvider {
  readonly providerKey = "mock" as const;
  polls = 0;
  failuresLeft: number;

  constructor(
    private readonly nowProvider: () => string,
    failuresLeft: number
  ) {
    this.failuresLeft = failuresLeft;
  }

  async poll(): Promise<PollResult> {
    this.polls += 1;
    if (this.failuresLeft > 0) {
      this.failuresLeft -= 1;
      throw new ProviderTransportError("provider unreachable", { status: 503 });
    }
    return new MockProvider(this.nowProvider).poll();
  }

  async health() {
    return {
      provider: this.providerKey,
      reachable: true,
      latencyMs: 0,
      checkedAt: this.nowProvider(),
    };
  }
}

const immediateRetry = {
  retryPolicy: defaultRetryPolicy({ maxAttempts: 2, sleep: async () => {} }),
};

describe("runScanCycle", () => {
  it("recovers from a total provider outage without losing data", async () => {
    let now = Date.parse(NOW);
    const provider = new FlakyProvider(() => new Date(now).toISOString(), Number.MAX_SAFE_INTEGER);
    const store = createMemoryWorkerStore([provider.providerKey]);

    const down = await runScanCycle({ provider, store, ...immediateRetry });

    expect(down.status).toBe("DOWN");
    expect(down.attempts).toBe(2);
    expect(down.sourceStatus).toBe("DOWN");
    expect(await store.getSourceStatus(provider.providerKey)).toBe("DOWN");
    expect(provider.polls).toBe(2);

    provider.failuresLeft = 0; // the provider comes back
    now += 60_000;

    const up = await runScanCycle({ provider, store, ...immediateRetry });

    expect(up.status).toBe("OK");
    expect(up.attempts).toBe(1);
    expect(up.sourceStatus).toBe("HEALTHY");
    expect(await store.getSourceStatus(provider.providerKey)).toBe("HEALTHY");

    const seeds = await store.loadEventSeeds();
    expect(seeds.length).toBe(2);

    const heartbeats = store.debugHeartbeats();
    // One row per run, not one per transition: the started probe and the
    // completion update the same row, because scanner_health.runId is unique
    // and listScannerRuns maps one row to one run. Two cycles ran here, so two
    // rows -- previously this asserted three.
    expect(heartbeats).toHaveLength(2);

    expect(heartbeats[0]?.runId).toBe(down.runId);
    expect(heartbeats[0]?.status).toBe("DOWN");
    expect(heartbeats[0]?.startedAt).toBeInstanceOf(Date);
    expect(heartbeats[0]?.finishedAt).toBeInstanceOf(Date);

    expect(heartbeats[1]?.runId).toBe(up.runId);
    expect(heartbeats[1]?.status).toBe("HEALTHY");
    expect(heartbeats[1]?.startedAt).toBeInstanceOf(Date);
    expect(heartbeats[1]?.finishedAt).toBeInstanceOf(Date);

    // The invariant that let this divergence ship: this fake used to append a
    // second row for the completion, which the database rejected with P2002. It
    // now mirrors the real adapter and refuses an orphan completion.
    await expect(
      store.completeHeartbeat({ runId: "run-that-never-started", status: "DOWN" })
    ).rejects.toThrow(/no in-flight heartbeat/);

    expect(up.collect.events).toBeGreaterThan(0);
    expect(up.collect.markets).toBeGreaterThan(0);
    expect(up.collect.selections).toBeGreaterThan(0);
    expect(up.detection).not.toBeNull();
    expect(up.detection?.scans).toBeGreaterThan(0);
    expect(store.debugRawPayloads().length).toBe(1);
  });

  it("retries a transient failure within the same cycle", async () => {
    const provider = new FlakyProvider(() => NOW, 1);
    const store = createMemoryWorkerStore([provider.providerKey]);

    const cycle = await runScanCycle({ provider, store, ...immediateRetry });

    expect(cycle.status).toBe("OK");
    expect(cycle.attempts).toBe(2);
    expect(cycle.sourceStatus).toBe("HEALTHY");
    expect(provider.polls).toBe(2);
  });
});

describe("createScanWorker", () => {
  it("runs cycles on schedule without overlap and stops cleanly", async () => {
    const provider = new MockProvider(() => NOW);
    const store = createMemoryWorkerStore([provider.providerKey]);
    let scheduled: (() => void) | null = null;
    const schedule = {
      schedule: (fn: () => void) => {
        scheduled = fn;
        return { cancel: () => (scheduled = null) };
      },
    };

    const worker = createScanWorker({
      deps: { provider, store },
      intervalMs: 1000,
      schedule,
      immediate: false,
    });
    worker.start();
    expect(worker.started()).toBe(true);
    expect(worker.runCount()).toBe(0);

    const tick = (): void => {
      const next = scheduled;
      if (next !== null) next();
    };

    tick();
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(worker.runCount()).toBe(1);
    expect(store.debugHeartbeats().length).toBeGreaterThan(0);

    tick();
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(worker.runCount()).toBe(2);

    await worker.stop();
    const afterStop = worker.runCount();
    tick();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(worker.runCount()).toBe(afterStop);
  });

  it("nativeScheduler arms a one-shot timer, not a repeating one", async () => {
    // The exact shape of the defect that shipped: schedule() was setInterval-based
    // while the worker also rescheduled itself, so a single scheduled call fired
    // repeatedly and every fire added another live timer. One call must fire once.
    let calls = 0;
    const handle = nativeScheduler().schedule(() => {
      calls += 1;
    }, 10);

    await new Promise((resolve) => setTimeout(resolve, 60));
    handle.cancel();

    expect(calls).toBe(1);
  });

  it("keeps one live timer and one in-flight cycle when a tick re-fires", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let concurrent = 0;
    let maxConcurrent = 0;

    const provider: OddsProvider = {
      providerKey: "mock",
      poll: async () => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await gate;
        concurrent -= 1;
        return new MockProvider(() => NOW).poll();
      },
      health: async () => ({ provider: "mock", reachable: true, latencyMs: 0, checkedAt: NOW }),
    };
    const store = createMemoryWorkerStore(["mock"]);

    const pending: Array<() => void> = [];
    const schedule = {
      schedule: (fn: () => void) => {
        pending.push(fn);
        return { cancel: () => {} };
      },
    };

    const worker = createScanWorker({
      deps: { provider, store },
      intervalMs: 1000,
      schedule,
      immediate: false,
    });

    worker.start();
    expect(pending).toHaveLength(1);

    const first = pending[0]!;
    first();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(worker.runCount()).toBe(1);
    expect(maxConcurrent).toBe(1);

    // A second live timer firing mid-cycle is what compounded in production. It
    // must be dropped without arming a replacement: the running cycle owns the
    // next timer, so the count stays at one instead of growing per re-fire.
    first();
    await new Promise((resolve) => setTimeout(resolve, 5));
    first();
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(maxConcurrent).toBe(1);
    expect(worker.runCount()).toBe(1);
    expect(pending).toHaveLength(1);

    release();
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Exactly one replacement timer, armed by the cycle that just finished.
    expect(worker.runCount()).toBe(1);
    expect(pending).toHaveLength(2);

    pending[1]!();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(worker.runCount()).toBe(2);
    expect(maxConcurrent).toBe(1);
    expect(pending).toHaveLength(3);

    await worker.stop();
  });

  it("stop() waits for an in-flight cycle to finish", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider: OddsProvider = {
      providerKey: "mock",
      poll: async () => {
        await gate;
        return new MockProvider(() => NOW).poll();
      },
      health: async () => ({ provider: "mock", reachable: true, latencyMs: 0, checkedAt: NOW }),
    };
    const store = createMemoryWorkerStore(["mock"]);

    const worker = createScanWorker({ deps: { provider, store }, intervalMs: 1000 });
    worker.start();

    let settled = false;
    const stopping = worker.stop().then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);

    release();
    await stopping;
    expect(settled).toBe(true);
    expect(worker.runCount()).toBe(1);
  });
});

/**
 * The worker is the only component that can see quota in the context of a cycle,
 * so it has to carry the reading out to the log. Two properties matter: it is
 * present on failures (an exhausted plan looks identical to a bad key otherwise),
 * and it never invents a number.
 */
describe("runScanCycle quota reporting", () => {
  /** Mock provider with a controllable quota reading. */
  function providerReporting(quota: ProviderQuota | undefined): OddsProvider {
    return {
      providerKey: "mock",
      quotaSnapshot: () => quota,
      poll: () => new MockProvider(() => NOW).poll(),
      health: async () => ({
        provider: "mock",
        reachable: true,
        latencyMs: 0,
        checkedAt: NOW,
      }),
    };
  }

  /** Provider that always fails, the way an exhausted plan looks. */
  function failingProviderReporting(quota: ProviderQuota | undefined): OddsProvider {
    return {
      providerKey: "mock",
      quotaSnapshot: () => quota,
      poll: async () => {
        throw new ProviderTransportError("401 unauthorized", { status: 401 });
      },
      health: async () => ({
        provider: "mock",
        reachable: true,
        latencyMs: 0,
        checkedAt: NOW,
      }),
    };
  }

  it("carries the balance out on a successful cycle", async () => {
    const provider = providerReporting({ remaining: 487, used: 13, last: 4 });
    const store = createMemoryWorkerStore(["mock"]);

    const result = await runScanCycle({ provider, store, ...immediateRetry });

    expect(result.status).toBe("OK");
    expect(result.quota).toEqual({ remaining: 487, used: 13, last: 4 });
  });

  it("carries the balance out on a failed cycle, which is the whole point", async () => {
    // All three slots are always present; `undefined` means "the provider did not
    // report it", which is why the exhausted case below shows `last: undefined`
    // rather than a guessed per-call cost.
    const provider = failingProviderReporting({ remaining: 0, used: 500, last: undefined });
    const store = createMemoryWorkerStore(["mock"]);

    const result = await runScanCycle({ provider, store, ...immediateRetry });

    expect(result.status).toBe("DOWN");
    // remaining=0 on a 401 is the difference between "plan exhausted, raise the
    // interval" and "the key is wrong" - same status, opposite response.
    expect(result.quota).toEqual({ remaining: 0, used: 500, last: undefined });
  });

  it("reports null, not a fabricated zero, when the provider reports nothing", async () => {
    const provider = providerReporting(undefined);
    const store = createMemoryWorkerStore(["mock"]);

    const result = await runScanCycle({ provider, store, ...immediateRetry });

    // A zero here would read as "out of quota" for the mock provider, which is
    // both false and alarming.
    expect(result.quota).toBeNull();
  });

  it("tolerates a provider with no quota capability at all", async () => {
    const provider: OddsProvider = {
      providerKey: "mock",
      poll: () => new MockProvider(() => NOW).poll(),
      health: async () => ({
        provider: "mock",
        reachable: true,
        latencyMs: 0,
        checkedAt: NOW,
      }),
    };
    const store = createMemoryWorkerStore(["mock"]);

    const result = await runScanCycle({ provider, store, ...immediateRetry });

    expect(result.quota).toBeNull();
  });
});
