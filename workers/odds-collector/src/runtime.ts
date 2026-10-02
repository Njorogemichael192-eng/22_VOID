/**
 * Scan worker runtime (Phase 14).
 *
 * `runScanCycle` runs one full cycle: rate-limit → poll (with retry/backoff) →
 * raw payload capture (§65) → normalize → persist → detect, then writes the
 * source's availability and a heartbeat. When polling fails permanently the
 * source is marked `DOWN`; the very next successful cycle marks it `HEALTHY`
 * again — the acceptance model "transient provider failures recover".
 *
 * `createScanWorker` is the long-lived scheduler around that cycle, with
 * non-overlapping overlap protection and an injectable schedule for tests.
 */

import { newRequestId } from "@22void/provider-contracts";
import { envelopeToCanonicalRecords } from "@22void/provider-contracts";
import type {
  OddsProvider,
  PollRequest,
  PollResult,
  ProviderKey,
} from "@22void/provider-contracts";

import { runDetection, type DetectionSummary } from "./detect.js";
import { reconcileOpportunityEpisodes, type ReconcileSummary } from "./history.js";
import { workerId } from "./identity.js";
import { normalizeRun, type NormalizeRunOutput } from "./normalize.js";
import { defaultRetryPolicy, type RetryPolicy, withRetry } from "./retry.js";
import type { RateLimiter } from "./rate-limit.js";
import type { WorkerSourceStatus, WorkerStore } from "./store.js";

export interface ScanCycleDeps {
  provider: OddsProvider;
  store: WorkerStore;
  pollRequest?: PollRequest;
  rateLimiter?: RateLimiter;
  retryPolicy?: RetryPolicy;
  workerName?: string;
}

export type ScanCycleStatus = "OK" | "DEGRADED" | "DOWN";

export interface ScanCollectCounts {
  events: number;
  markets: number;
  selections: number;
  observations: number;
  rejected: number;
  invalid: number;
}

export interface ScanCycleResult {
  runId: string;
  worker: string;
  provider: ProviderKey;
  receivedAt: string;
  status: ScanCycleStatus;
  error?: string;
  attempts: number;
  collect: ScanCollectCounts;
  normalized: NormalizeRunOutput["normalized"];
  detection: DetectionSummary | null;
  /** Phase 15 reconciliation outcome (present only when detection ran). */
  history?: ReconcileSummary;
  sourceStatus: WorkerSourceStatus;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Runs one complete scan cycle. */
export async function runScanCycle(deps: ScanCycleDeps): Promise<ScanCycleResult> {
  const sourceKey = deps.provider.providerKey;
  const worker = deps.workerName ?? workerId();
  const runId = newRequestId();
  const startedAt = new Date();

  await deps.store.recordHeartbeat({
    runId,
    sourceKey,
    status: "HEALTHY",
    startedAt,
  });

  let attempts = 0;
  let pollResult: PollResult | undefined;
  let lastError: unknown;
  try {
    pollResult = await withRetry(async () => {
      attempts += 1;
      if (deps.rateLimiter !== undefined) await deps.rateLimiter.acquire();
      return deps.provider.poll(deps.pollRequest);
    }, deps.retryPolicy ?? defaultRetryPolicy());
  } catch (error) {
    lastError = error;
  }

  const finishedAt = new Date();
  if (pollResult === undefined) {
    const message = `poll failed after ${attempts} attempt(s): ${errorMessage(lastError)}`;
    await deps.store.markSourceStatus(sourceKey, "DOWN");
    await deps.store.completeHeartbeat({ runId, status: "DOWN", message, finishedAt });
    return {
      runId,
      worker,
      provider: sourceKey,
      receivedAt: startedAt.toISOString(),
      status: "DOWN",
      error: message,
      attempts,
      collect: { events: 0, markets: 0, selections: 0, observations: 0, rejected: 0, invalid: 0 },
      normalized: [],
      detection: null,
      sourceStatus: "DOWN",
    };
  }

  try {
    await deps.store.markSourceStatus(sourceKey, "HEALTHY");
    await deps.store.storeRaw(pollResult.rawPayload);

    const records = envelopeToCanonicalRecords(pollResult.envelope);
    const seeds = await deps.store.loadEventSeeds();
    const normalized = normalizeRun(sourceKey, records, seeds);
    const persist = await deps.store.persistRun(normalized.persist);
    const detection = await runDetection(deps.store, {
      now: Date.parse(pollResult.envelope.receivedAt),
    });
    const history = await reconcileOpportunityEpisodes(deps.store, detection, {
      now: Date.parse(pollResult.envelope.receivedAt),
    });

    const message = JSON.stringify({
      normalized: normalized.normalized.map((entry) => ({
        id: entry.canonicalEventId,
        action: entry.action,
        confidence: entry.confidence,
      })),
      persist,
      detection: {
        priced: detection.priced,
        scans: detection.scans,
        arbs: detection.arbs,
        opportunities: detection.opportunities,
      },
      history,
    });
    await deps.store.completeHeartbeat({ runId, status: "HEALTHY", message, finishedAt });

    return {
      runId,
      worker,
      provider: sourceKey,
      receivedAt: pollResult.envelope.receivedAt,
      status: "OK",
      attempts,
      collect: {
        events: persist.events,
        markets: persist.markets,
        selections: persist.selections,
        observations: persist.observations,
        rejected: records.rejected.length,
        invalid: persist.invalid,
      },
      normalized: normalized.normalized,
      detection: {
        priced: detection.priced,
        scans: detection.scans,
        arbs: detection.arbs,
        opportunities: detection.opportunities.length,
      },
      history,
      sourceStatus: "HEALTHY",
    };
  } catch (error) {
    const message = `processing failed after poll: ${errorMessage(error)}`;
    await deps.store.markSourceStatus(sourceKey, "DEGRADED");
    await deps.store.completeHeartbeat({ runId, status: "DEGRADED", message, finishedAt });
    return {
      runId,
      worker,
      provider: sourceKey,
      receivedAt: pollResult.envelope.receivedAt,
      status: "DEGRADED",
      error: message,
      attempts,
      collect: { events: 0, markets: 0, selections: 0, observations: 0, rejected: 0, invalid: 0 },
      normalized: [],
      detection: null,
      sourceStatus: "DEGRADED",
    };
  }
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export interface ScheduleHandle {
  cancel(): void;
}

export interface ScanScheduler {
  schedule(fn: () => void, ms: number): ScheduleHandle;
}

/**
 * Native one-shot timer scheduler (timer is unref'd so exit stays clean).
 *
 * This must stay a one-shot `setTimeout`. The worker reschedules itself after
 * every completed cycle, so an interval-based primitive both re-fires on its own
 * and adds a fresh handle each time: live timers accumulate without bound and
 * the cycle rate compounds. That defect drove the worker to thousands of cycles
 * per minute, which starved the DB pool and filled `scanner_health` with orphans.
 */
export function nativeScheduler(): ScanScheduler {
  return {
    schedule(fn, ms) {
      const handle = setTimeout(fn, ms);
      handle.unref?.();
      return { cancel: () => clearTimeout(handle) };
    },
  };
}

export interface ScanWorkerOptions {
  deps: ScanCycleDeps;
  intervalMs: number;
  schedule?: ScanScheduler;
  immediate?: boolean;
  stopOnError?: boolean;
  onRun?: (result: ScanCycleResult | null, error?: unknown) => void;
}

export interface ScanWorker {
  readonly startedAt: number | null;
  started(): boolean;
  runCount(): number;
  start(): void;
  stop(): Promise<void>;
}

/**
 * Long-lived scheduler that runs at most one scan cycle per interval, never
 * overlapping. Exactly one timer is live at a time and it is armed only once a
 * cycle has completed, so a slow cycle cannot be joined by a second one and
 * cannot accumulate timers.
 */
export function createScanWorker(options: ScanWorkerOptions): ScanWorker {
  const intervalMs = options.intervalMs;
  const scheduler = options.schedule ?? nativeScheduler();
  const immediate = options.immediate ?? true;
  const stopOnError = options.stopOnError ?? false;

  let startedAt: number | null = null;
  let cancelled = false;
  let timer: ScheduleHandle | null = null;
  let inFlight: Promise<void> | null = null;
  let runs = 0;

  const runCycle = async (): Promise<void> => {
    try {
      const result = await runScanCycle(options.deps);
      options.onRun?.(result);
    } catch (error) {
      if (stopOnError) cancelled = true;
      options.onRun?.(null, error);
    }
  };

  const runOnce = async (): Promise<void> => {
    if (cancelled) return;

    // Overlap guard. A tick that lands while a cycle is still running is dropped
    // rather than acted on, and deliberately does not arm a replacement timer:
    // the in-flight cycle arms the next one when it completes. Concurrent cycles
    // contend for the same connection pool, and arming here is what let timers
    // compound. Keeping the count at one live timer and one in-flight cycle is
    // what makes the interval a floor on the cycle rate rather than a target.
    if (inFlight !== null) return;

    runs += 1;
    inFlight = runCycle();
    try {
      await inFlight;
    } finally {
      inFlight = null;
      if (!cancelled) timer = scheduler.schedule(() => void runOnce(), intervalMs);
    }
  };

  return {
    get startedAt() {
      return startedAt;
    },
    started() {
      return startedAt !== null;
    },
    runCount() {
      return runs;
    },
    start() {
      if (startedAt !== null) return;
      startedAt = Date.now();
      if (immediate) {
        // runOnce owns `inFlight` for every cycle, not just the first one, so that
        // stop() waits on whichever cycle is actually running.
        void runOnce();
      } else {
        timer = scheduler.schedule(() => void runOnce(), intervalMs);
      }
    },
    async stop() {
      cancelled = true;
      timer?.cancel();
      timer = null;
      if (inFlight !== null) await inFlight;
    },
  };
}
