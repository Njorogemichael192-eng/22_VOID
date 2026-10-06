/**
 * Scan worker runtime (Phase 14; multi-provider as of Phase 19).
 *
 * `runScanCycle` runs one full cycle across every provider `WORKER_PROVIDER`
 * names. Each provider is polled in turn — rate-limit → poll (retry/backoff) →
 * raw payload capture (§65) → normalize → persist — writing that provider's own
 * availability and heartbeat, then a single detect → reconcile pass runs over
 * the combined prices. Detection is shared because arbitrage across two books
 * from two different providers only exists once both feeds are in the store;
 * running it per provider would compare each feed against itself.
 *
 * One `scanner_health` row per provider per cycle (not one per cycle) so
 * `sourceLatencyStats` still reports per-source latency, and so a provider that
 * is down is visible as its own unhealthy source rather than as a whole-cycle
 * failure that hides the feed that did work.
 *
 * Per-provider status reflects only that provider's poll→persist, so a
 * detection failure leaves the sources `HEALTHY` (they were) and degrades the
 * *cycle*, which is what `/healthz` consumes. The acceptance model "transient
 * provider failures recover" is unchanged: `DOWN` on the next successful cycle
 * marks the source `HEALTHY` again.
 *
 * `createScanWorker` is the long-lived scheduler around that cycle, with
 * non-overlap protection and an injectable schedule for tests.
 */

import { newRequestId } from "@22void/provider-contracts";
import { envelopeToCanonicalRecords } from "@22void/provider-contracts";
import type {
  OddsProvider,
  PollRequest,
  PollResult,
  ProviderKey,
  ProviderQuota,
} from "@22void/provider-contracts";

import { runDetection, type DetectionReport, type DetectionSummary } from "./detect.js";
import { reconcileOpportunityEpisodes, type ReconcileSummary } from "./history.js";
import { workerId } from "./identity.js";
import { normalizeRun, type NormalizeRunOutput } from "./normalize.js";
import { defaultRetryPolicy, type RetryPolicy, withRetry } from "./retry.js";
import type { RateLimiter } from "./rate-limit.js";
import type { WorkerSourceStatus, WorkerStore } from "./store.js";

export interface ScanCycleDeps {
  /**
   * Providers polled once per cycle, in list order. At least one is required:
   * an empty list would run detection over stale prices and report a healthy
   * cycle that polled nothing.
   */
  providers: readonly OddsProvider[];
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

/** One provider's outcome within the cycle. */
export interface ScanCycleSourceOutcome {
  runId: string;
  provider: ProviderKey;
  /** The envelope's `receivedAt` on success, else the time the poll started. */
  receivedAt: string;
  status: ScanCycleStatus;
  error?: string;
  attempts: number;
  collect: ScanCollectCounts;
  normalized: NormalizeRunOutput["normalized"];
  sourceStatus: WorkerSourceStatus;
  /**
   * Provider credit balance after this poll, or null when the provider reports
   * no quota headers.
   *
   * Carried per source rather than on the cycle: each provider bills its own
   * quota, so a single cycle-level number would be meaningless the moment more
   * than one provider is configured — and on a DOWN source it is the reading
   * that distinguishes an exhausted plan from a bad key, which are otherwise
   * the same opaque 401.
   */
  quota: ProviderQuota | null;
}

export interface ScanCycleResult {
  worker: string;
  /** Most recent successful envelope `receivedAt`, else the cycle start. */
  receivedAt: string;
  status: ScanCycleStatus;
  error?: string;
  sources: readonly ScanCycleSourceOutcome[];
  /** Sum across providers. */
  attempts: number;
  /** Sum across providers. */
  collect: ScanCollectCounts;
  /** All providers' normalization entries, in provider order. */
  normalized: NormalizeRunOutput["normalized"];
  detection: DetectionSummary | null;
  /** Phase 15 reconciliation outcome (present only when detection ran). */
  history?: ReconcileSummary;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emptyCollect(): ScanCollectCounts {
  return { events: 0, markets: 0, selections: 0, observations: 0, rejected: 0, invalid: 0 };
}

function addCollect(target: ScanCollectCounts, source: ScanCollectCounts): void {
  target.events += source.events;
  target.markets += source.markets;
  target.selections += source.selections;
  target.observations += source.observations;
  target.rejected += source.rejected;
  target.invalid += source.invalid;
}

/**
 * Internal per-provider run: the outcome plus whatever is needed to close the
 * heartbeat row once the shared detection pass has produced its summary.
 *
 * The row is opened before the poll and closed after detection, but `finishedAt`
 * is pinned to the moment that provider's own persist completed, so
 * `sourceLatencyStats` keeps reporting poll-to-persist for this source instead
 * of absorbing the other providers' polls into its latency.
 */
interface SourceRun {
  outcome: ScanCycleSourceOutcome;
  /** Null once the heartbeat row has been closed (all failure paths close it). */
  open: { persist: Awaited<ReturnType<WorkerStore["persistRun"]>>; finishedAt: Date } | null;
}

/** Polls and persists one provider; opens that provider's heartbeat row. */
async function pollSource(provider: OddsProvider, deps: ScanCycleDeps): Promise<SourceRun> {
  const sourceKey = provider.providerKey;
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
      return provider.poll(deps.pollRequest);
    }, deps.retryPolicy ?? defaultRetryPolicy());
  } catch (error) {
    lastError = error;
  }

  if (pollResult === undefined) {
    const message = `poll failed after ${attempts} attempt(s): ${errorMessage(lastError)}`;
    const finishedAt = new Date();
    await deps.store.markSourceStatus(sourceKey, "DOWN");
    await deps.store.completeHeartbeat({ runId, status: "DOWN", message, finishedAt });
    return {
      outcome: {
        runId,
        provider: sourceKey,
        receivedAt: startedAt.toISOString(),
        status: "DOWN",
        error: message,
        attempts,
        collect: emptyCollect(),
        normalized: [],
        sourceStatus: "DOWN",
        // Read even on the failure path: the poll failed *after the provider
        // answered, so the quota reading is the one that explains why.
        quota: provider.quotaSnapshot?.() ?? null,
      },
      open: null,
    };
  }

  try {
    await deps.store.markSourceStatus(sourceKey, "HEALTHY");
    await deps.store.storeRaw(pollResult.rawPayload);

    const records = envelopeToCanonicalRecords(pollResult.envelope);
    const seeds = await deps.store.loadEventSeeds();
    const normalized = normalizeRun(sourceKey, records, seeds);
    const persist = await deps.store.persistRun(normalized.persist);

    return {
      outcome: {
        runId,
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
        sourceStatus: "HEALTHY",
        quota: provider.quotaSnapshot?.() ?? null,
      },
      open: { persist, finishedAt: new Date() },
    };
  } catch (error) {
    const message = `processing failed after poll: ${errorMessage(error)}`;
    const finishedAt = new Date();
    await deps.store.markSourceStatus(sourceKey, "DEGRADED");
    await deps.store.completeHeartbeat({ runId, status: "DEGRADED", message, finishedAt });
    return {
      outcome: {
        runId,
        provider: sourceKey,
        receivedAt: pollResult.envelope.receivedAt,
        status: "DEGRADED",
        error: message,
        attempts,
        collect: emptyCollect(),
        normalized: [],
        sourceStatus: "DEGRADED",
        quota: provider.quotaSnapshot?.() ?? null,
      },
      open: null,
    };
  }
}

function aggregateStatus(
  sources: readonly ScanCycleSourceOutcome[],
  detectionError: string | undefined
): ScanCycleStatus {
  // Detection is a worker-level step, not a provider's: a failure there can only
  // degrade the cycle, never condemn a provider that delivered its prices.
  if (detectionError !== undefined) return "DEGRADED";
  const statuses = new Set(sources.map((source) => source.status));
  if (statuses.size === 1) return [...statuses][0]!;
  // Mixed outcomes mean part of the configured feed is missing, which is the
  // definition of a degraded cycle even when every healthy source is perfect.
  return "DEGRADED";
}

/** Runs one complete scan cycle across every configured provider. */
export async function runScanCycle(deps: ScanCycleDeps): Promise<ScanCycleResult> {
  if (deps.providers.length === 0) {
    throw new Error(
      "runScanCycle requires at least one provider; an empty WORKER_PROVIDER list would " +
        "run detection over whatever prices the previous cycle left behind and report it " +
        "as a healthy poll"
    );
  }

  const worker = deps.workerName ?? workerId();
  const cycleStartedAt = new Date();

  const runs: SourceRun[] = [];
  for (const provider of deps.providers) {
    runs.push(await pollSource(provider, deps));
  }
  const sources = runs.map((run) => run.outcome);

  // Detection sees every provider's prices for this cycle, so it runs once,
  // after the last provider has persisted. `now` is the freshest envelope in the
  // cycle: the oldest still-valid price in it is what the freshness policy is
  // measured against, and using a slower provider's timestamp would flatter the
  // faster provider's prices.
  const succeeded = sources.filter((source) => source.status === "OK");
  let report: DetectionReport | null = null;
  let history: ReconcileSummary | undefined;
  let detectionError: string | undefined;
  let receivedAt = cycleStartedAt.toISOString();

  if (succeeded.length > 0) {
    receivedAt =
      succeeded
        .map((source) => source.receivedAt)
        .sort()
        .at(-1) ?? receivedAt;
    const now = Date.parse(receivedAt);
    try {
      report = await runDetection(deps.store, { now });
      history = await reconcileOpportunityEpisodes(deps.store, report, { now });
    } catch (error) {
      detectionError = `detection failed after persist: ${errorMessage(error)}`;
    }
  }

  const detection: DetectionSummary | null =
    report === null
      ? null
      : {
          priced: report.priced,
          scans: report.scans,
          capped: report.capped,
          arbs: report.arbs,
          opportunities: report.opportunities.length,
        };

  for (const run of runs) {
    if (run.open === null) continue;
    const message = JSON.stringify({
      normalized: run.outcome.normalized.map((entry) => ({
        id: entry.canonicalEventId,
        action: entry.action,
        confidence: entry.confidence,
      })),
      persist: run.open.persist,
      ...(report === null
        ? {}
        : {
            detection: {
              priced: report.priced,
              scans: report.scans,
              capped: report.capped,
              arbs: report.arbs,
              opportunities: report.opportunities,
            },
          }),
      ...(history === undefined ? {} : { history }),
      ...(detectionError === undefined ? {} : { detectionError }),
    });
    await deps.store.completeHeartbeat({
      runId: run.outcome.runId,
      status: "HEALTHY",
      message,
      finishedAt: run.open.finishedAt,
    });
  }

  const collect = emptyCollect();
  let attempts = 0;
  const normalized: NormalizeRunOutput["normalized"] = [];
  const errors: string[] = detectionError === undefined ? [] : [detectionError];
  for (const source of sources) {
    addCollect(collect, source.collect);
    attempts += source.attempts;
    normalized.push(...source.normalized);
    if (source.error !== undefined) errors.push(`${source.provider}: ${source.error}`);
  }

  const status = aggregateStatus(sources, detectionError);
  return {
    worker,
    receivedAt,
    status,
    ...(errors.length > 0 ? { error: errors.join("; ") } : {}),
    sources,
    attempts,
    collect,
    normalized,
    detection,
    ...(history === undefined ? {} : { history }),
  };
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
