import { MockProvider, ProviderTransportError } from "@22void/provider-contracts";
import type { OddsProvider } from "@22void/provider-contracts";
import { describe, expect, it, vi } from "vitest";

import { runCollectOnce, workerId } from "./index.js";

const NOW = "2026-09-21T12:00:00.000Z";

describe("runCollectOnce", () => {
  it("polls the provider, converts to canonical records and stores the raw payload", async () => {
    const provider = new MockProvider(() => NOW);
    const storePayload = vi.fn();

    const summary = await runCollectOnce({ provider, storePayload });

    expect(summary.provider).toBe("mock");
    expect(summary.receivedAt).toBe(NOW);
    expect(summary.events).toBe(2);
    expect(summary.markets).toBeGreaterThan(0);
    expect(summary.selections).toBeGreaterThan(0);
    expect(summary.rejected).toBe(0);
    expect(summary.skippedOutcomes).toBe(0);

    expect(storePayload).toHaveBeenCalledTimes(1);
    const raw = storePayload.mock.calls[0]?.[0];
    expect(raw.provider).toBe("mock");
    expect(raw.receivedAt).toBe(NOW);
  });

  it("does not require a store hook", async () => {
    const provider = new MockProvider(() => NOW);
    const summary = await runCollectOnce({ provider });
    expect(summary.events).toBe(2);
  });

  it("propagates provider transport errors", async () => {
    const failing: OddsProvider = {
      providerKey: "mock",
      poll: async () => {
        throw new ProviderTransportError("boom", { status: 429 });
      },
      health: async () => ({ provider: "mock", reachable: true, latencyMs: 0, checkedAt: NOW }),
    };
    await expect(runCollectOnce({ provider: failing })).rejects.toSatisfy(
      (error: unknown) => error instanceof ProviderTransportError
    );
  });

  it("surfaces raw payload store failures", async () => {
    const provider = new MockProvider(() => NOW);
    const storePayload = vi.fn(async () => {
      throw new Error("disk full");
    });
    await expect(runCollectOnce({ provider, storePayload })).rejects.toThrow("disk full");
  });
});

describe("worker identity", () => {
  it("returns a process-unique id", () => {
    expect(workerId()).toMatch(/^odds-collector-\d+$/);
  });
});
