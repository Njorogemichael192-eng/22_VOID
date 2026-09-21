/**
 * @22void/odds-collector
 *
 * Scheduled odds polling worker (BUILD_AGENT_PROMPT Phase 14).
 * Responsibilities: provider polling, rate limiting, retries/backoff, raw payload
 * capture, normalization job triggers, detection job triggers, heartbeat.
 *
 * Status: polling primitive (Phase 3). The operator loop (cron, rate limits,
 * retries, persistence of raw payloads to PostgreSQL via @22void/db, heartbeat)
 * is scheduled in Phase 14. `runCollectOnce` is the unit the scheduler will
 * invoke: one provider poll, one canonical-record conversion, one (optional)
 * raw payload store callback.
 */

import {
  type OddsProvider,
  type PollRequest,
  type ProviderKey,
  type RawProviderPayload,
  envelopeToCanonicalRecords,
  summarizeCanonicalRecords,
} from "@22void/provider-contracts";

export interface WorkerHeartbeat {
  workerId: string;
  lastRunAt?: string;
  scansInFlight: number;
}

/** Returns the default worker id for this process. */
export function workerId(): string {
  return `odds-collector-${process.pid}`;
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
