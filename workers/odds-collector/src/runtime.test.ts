import {
  MockProvider,
  ProviderTransportError,
  type OddsProvider,
  type PollResult,
} from "@22void/provider-contracts";
import { describe, expect, it } from "vitest";

import { defaultRetryPolicy } from "./retry.js";
import { createScanWorker, runScanCycle } from "./runtime.js";
import { createMemoryWorkerStore } from "./store.js";

const NOW = "2026-09-21T12:00:00.000Z";

/** Provider that fails with a transient error `failuresLeft` times, then succeeds. */
class FlakyProvider implements OddsProvider {
  readonly providerKey = "mock" as const;
  polls = 0;
  failuresLeft: number;

  constructor(private readonly nowProvider: () => string, failuresLeft: number) {
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
    return { provider: this.providerKey, reachable: true, latencyMs: 0, checkedAt: this.nowProvider() };
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
    expect(heartbeats[0]?.status).toBe("HEALTHY"); // started probe
    expect(heartbeats.some((entry) => entry.status === "DOWN")).toBe(true);
    expect(heartbeats.at(-1)?.status).toBe("HEALTHY");

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