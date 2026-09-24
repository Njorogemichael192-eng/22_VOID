/**
 * @22void/odds-collector
 *
 * Scheduled odds polling worker (BUILD_AGENT_PROMPT Phase 14).
 * Responsibilities: provider polling, rate limiting, retries/backoff, raw payload
 * capture, normalization job triggers, detection job triggers, heartbeat.
 *
 * Phase 14 ships the operator loop on top of the Phase 3 polling primitive
 * (`runCollectOnce`): `createScanWorker`/`runScanCycle` (runtime), the token
 * bucket rate limiter, retry/backoff, the normalization job (`normalizeRun`)
 * and the detection job (`runDetection`). Raw payloads feed @22void/db through
 * the store port; a memory store stands in for tests and sandbox runs.
 */

import {
  type OddsProvider,
  type PollRequest,
  type ProviderKey,
  type RawProviderPayload,
  envelopeToCanonicalRecords,
  summarizeCanonicalRecords,
} from "@22void/provider-contracts";

export { workerId } from "./identity.js";
export * from "./retry.js";
export * from "./rate-limit.js";
export * from "./normalize.js";
export * from "./detect.js";
export * from "./history.js";
export * from "./runtime.js";
export * from "./store.js";

export interface WorkerHeartbeat {
  workerId: string;
  lastRunAt?: string;
  scansInFlight: number;
}

export interface CollectDeps {
  provider: OddsProvider;
  pollRequest?: PollRequest;
  /** Optional persistence hook; called with the verbatim raw payload (spec §65). */
  storePayload?: (raw: RawProviderPayload) => Promise<void> | void;
}

export interface CollectSummary {
  provider: ProviderKey;
  requestId: string;
  receivedAt: string;
  events: number;
  markets: number;
  selections: number;
  rejected: number;
  skippedOutcomes: number;
}

/** One provider poll: translate, convert to canonical records, persist raw. */
export async function runCollectOnce(deps: CollectDeps): Promise<CollectSummary> {
  const result = await deps.provider.poll(deps.pollRequest);

  if (deps.storePayload !== undefined) {
    await deps.storePayload(result.rawPayload);
  }

  const records = envelopeToCanonicalRecords(result.envelope);
  const summary = summarizeCanonicalRecords(records);
  return {
    provider: result.envelope.provider,
    requestId: result.envelope.requestId,
    receivedAt: result.envelope.receivedAt,
    events: summary.events,
    markets: summary.markets,
    selections: summary.selections,
    rejected: summary.rejected,
    skippedOutcomes: result.envelope.skippedOutcomes.length,
  };
}
