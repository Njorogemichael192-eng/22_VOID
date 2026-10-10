/**
 * Worker alerting wiring (Phase 19).
 *
 * `@22void/alerting` speaks in terms of a `HealthSnapshot`; this module is the
 * small translation from what the worker actually has — a `WorkerHealthSnapshot`
 * (cycle status/age) and one `ScanCycleResult` per cycle (per-source status) —
 * into that vocabulary, plus a factory that turns the resolved config into a
 * notifier.
 *
 * The worker-level status is read from the health state rather than the last
 * cycle result on purpose: the health state is the only thing that knows a cycle
 * is *stale* (none has completed recently), which is exactly the "worker asleep"
 * case a per-cycle evaluation can never see.
 */

import {
  createAlertNotifier,
  createWebhookAlertSink,
  type AlertNotifier,
  type HealthLevel,
  type HealthSnapshot,
  type SourceSignal,
} from "@22void/alerting";

import type { ResolvedAlertConfig } from "./config.js";
import type { HealthStatus, WorkerHealthSnapshot } from "./health.js";
import type { ScanCycleResult } from "./runtime.js";
import type { WorkerSourceStatus } from "./store.js";

const HEALTH_LEVEL_BY_STATUS: Readonly<Record<HealthStatus, HealthLevel>> = {
  ok: "HEALTHY",
  // Startup is not an incident: the worker is inside its grace window, and
  // alerting on "starting" would notify on every deploy.
  starting: "HEALTHY",
  degraded: "DEGRADED",
  down: "DOWN",
  error: "DOWN",
  stale: "DOWN",
};

function sourceLevel(status: WorkerSourceStatus): HealthLevel {
  if (status === "HEALTHY") return "HEALTHY";
  if (status === "DOWN") return "DOWN";
  // UNKNOWN is not produced on the outcome path (the runtime sets
  // HEALTHY/DOWN/DEGRADED), so this is only a type-completeness case; DEGRADED
  // is the honest choice for "we do not know" rather than a hard DOWN.
  return "DEGRADED";
}

function parseAt(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : fallback;
}

/** One signal per source this cycle polled, for the evaluator. */
export function sourceSignals(result: ScanCycleResult, now: number): readonly SourceSignal[] {
  const fallback = parseAt(result.receivedAt, now);
  return result.sources.map((source) => ({
    key: source.provider,
    status: sourceLevel(source.sourceStatus),
    at: parseAt(source.receivedAt, fallback),
  }));
}

export function buildHealthSnapshot(input: {
  health: WorkerHealthSnapshot;
  sources: readonly SourceSignal[];
  now: number;
}): HealthSnapshot {
  return {
    at: input.now,
    cycle: {
      status: HEALTH_LEVEL_BY_STATUS[input.health.status],
      at: parseAt(input.health.lastCycleAt, input.now),
    },
    sources: input.sources,
  };
}

/**
 * Build the notifier, or null when alerting is off.
 *
 * Off is the default and the common case (no webhook configured), and it must be
 * genuinely free: returning null lets the caller skip evaluation entirely rather
 * than evaluate and discard.
 */
export function createAlertNotifierFromConfig(
  config: ResolvedAlertConfig
): AlertNotifier | null {
  if (!config.enabled || config.webhookUrl === undefined) return null;
  return createAlertNotifier({
    sink: createWebhookAlertSink({ url: config.webhookUrl }),
    policy: {
      minSeverity: config.minSeverity,
      renotifyMs: config.renotifyMs,
      hysteresis: config.hysteresis,
    },
  });
}
