import type { ProviderKey } from "@22void/provider-contracts";
import { describe, expect, it } from "vitest";

import { buildHealthSnapshot, createAlertNotifierFromConfig, sourceSignals } from "./alerts.js";
import type { HealthStatus, WorkerHealthSnapshot } from "./health.js";
import type { ScanCycleResult } from "./runtime.js";
import type { WorkerSourceStatus } from "./store.js";

const EMPTY_COLLECT = {
  events: 0,
  markets: 0,
  selections: 0,
  observations: 0,
  rejected: 0,
  invalid: 0,
} as const;

function cycle(
  sources: ReadonlyArray<{
    provider: ProviderKey;
    status: WorkerSourceStatus;
    receivedAt: string;
  }>,
  receivedAt: string
): ScanCycleResult {
  return {
    worker: "test-worker",
    receivedAt,
    status: "OK",
    sources: sources.map((source) => ({
      runId: "run",
      provider: source.provider,
      receivedAt: source.receivedAt,
      status: "OK",
      attempts: 1,
      collect: EMPTY_COLLECT,
      normalized: [],
      sourceStatus: source.status,
      quota: null,
    })),
    attempts: sources.length,
    collect: EMPTY_COLLECT,
    normalized: [],
    detection: null,
  };
}

function workerHealth(status: HealthStatus, lastCycleAt: string | null = null): WorkerHealthSnapshot {
  return {
    ready: status === "ok",
    status,
    service: "@22void/odds-collector",
    workerId: "test-worker",
    startedAt: "2026-10-10T00:00:00.000Z",
    lastCycleAt,
    lastCycleStatus: status,
    runCount: 1,
    pid: 1,
  };
}

describe("sourceSignals", () => {
  it("maps each source's availability and timestamp", () => {
    const signals = sourceSignals(
      cycle(
        [
          { provider: "odds-api", status: "HEALTHY", receivedAt: "2026-10-10T10:00:00.000Z" },
          { provider: "parlay-api", status: "DOWN", receivedAt: "2026-10-10T10:00:01.000Z" },
        ],
        "2026-10-10T10:00:01.000Z"
      ),
      1_000
    );

    expect(signals).toHaveLength(2);
    expect(signals.find((signal) => signal.key === "odds-api")).toEqual({
      key: "odds-api",
      status: "HEALTHY",
      at: Date.parse("2026-10-10T10:00:00.000Z"),
    });
    expect(signals.find((signal) => signal.key === "parlay-api")?.status).toBe("DOWN");
  });

  it("falls back to the cycle time when a source timestamp is unusable", () => {
    const signals = sourceSignals(
      cycle([{ provider: "mock", status: "DEGRADED", receivedAt: "not-a-date" }], "not-a-date"),
      4_242
    );
    expect(signals[0]).toEqual({ key: "mock", status: "DEGRADED", at: 4_242 });
  });
});

describe("buildHealthSnapshot", () => {
  const cases: ReadonlyArray<[HealthStatus, string]> = [
    ["ok", "HEALTHY"],
    ["starting", "HEALTHY"],
    ["degraded", "DEGRADED"],
    ["down", "DOWN"],
    ["error", "DOWN"],
    ["stale", "DOWN"],
  ];

  it.each(cases)("maps worker status %s to %s", (status, expected) => {
    const snapshot = buildHealthSnapshot({
      health: workerHealth(status),
      sources: [],
      now: 5_000,
    });
    expect(snapshot.cycle.status).toBe(expected);
    expect(snapshot.at).toBe(5_000);
  });

  it("uses the last cycle time as the signal time", () => {
    const snapshot = buildHealthSnapshot({
      health: workerHealth("stale", "2026-10-10T00:00:00.000Z"),
      sources: [],
      now: 5_000,
    });
    expect(snapshot.cycle.at).toBe(Date.parse("2026-10-10T00:00:00.000Z"));
  });
});

describe("createAlertNotifierFromConfig", () => {
  it("returns null when alerting is disabled", () => {
    expect(
      createAlertNotifierFromConfig({
        enabled: false,
        renotifyMs: 0,
        minSeverity: "warning",
        hysteresis: 1,
        checkIntervalMs: 30_000,
      })
    ).toBeNull();
  });

  it("returns a notifier when a webhook is configured", () => {
    const notifier = createAlertNotifierFromConfig({
      enabled: true,
      webhookUrl: "https://hooks.example/alert",
      renotifyMs: 0,
      minSeverity: "warning",
      hysteresis: 1,
      checkIntervalMs: 30_000,
    });
    expect(notifier).not.toBeNull();
  });
});
