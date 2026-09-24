/**
 * Detection job (Phase 14).
 *
 * Reads the freshly persisted priced selections, runs the Phase 10 candidate
 * pipeline (`scanCandidates`) and validates every `ARB` scan with the Phase 11
 * validator (spec §38–§40). The final recheck (§39) is served by the same cycle:
 * the prices persisted this cycle *are* the current prices, so the recheck is
 * the self-consistent `VERIFIED_ARB` path unless validation rejects the
 * opportunity for freshness/confidence reasons.
 *
 * Opportunities that survive are translated into the persistence input the
 * store writes (opportunity + legs + audit trail). Rejected/theoretical
 * outcomes are also persisted with their structured reason — a silent drop
 * would violate the audit principle (spec §66).
 */

import {
  type PricedSelection,
  scanCandidates,
  type CandidateScan,
  validateCandidate,
  type ValidationOptions,
} from "@22void/arbitrage";
import {
  computeOpportunityKey,
  type DbPricedSelection,
  type PersistOpportunityInput,
  type PersistOpportunityLegInput,
} from "@22void/db";

import type { WorkerStore } from "./store.js";

export interface DetectionOptions extends ValidationOptions {
  totalStake?: number;
  now?: number;
}

export interface DetectionSummary {
  priced: number;
  scans: number;
  arbs: number;
  opportunities: number;
}

export interface DetectionReport extends Omit<DetectionSummary, "opportunities"> {
  opportunities: PersistOpportunityInput[];
}

const ENGINE_VERSION = "odds-collector@0.0.0";

function toPricedSelection(row: DbPricedSelection): PricedSelection {
  return {
    id: row.id,
    eventId: row.eventId,
    selection: {
      family: row.family,
      marketType: row.marketType as PricedSelection["selection"]["marketType"],
      period: row.period,
      ...(row.participant !== null
        ? {
            participant: row.participant as NonNullable<PricedSelection["selection"]["participant"]>,
          }
        : {}),
      ...(row.line !== null
        ? { line: row.line as NonNullable<PricedSelection["selection"]["line"]> }
        : {}),
      outcome: row.outcome,
    },
    odds: row.odds,
    bookmaker: row.bookmaker,
    observedAt: row.observedAt,
    ...(row.sourceUpdatedAt !== undefined ? { sourceUpdatedAt: row.sourceUpdatedAt } : {}),
    provider: row.provider,
    sourceStatus: row.sourceStatus,
    ...(row.eventConfidence !== undefined ? { eventConfidence: row.eventConfidence } : {}),
    settlementRuleVersion: row.settlementRuleVersion,
    settlementConfidence: row.settlementConfidence,
  };
}

function toOpportunity(scan: CandidateScan, options: DetectionOptions): PersistOpportunityInput {
  const report = validateCandidate(
    scan,
    scan.candidate.legs,
    { ...(options as ValidationOptions), now: options.now ?? Date.now() },
    scan.candidate.legs.map((leg) => ({ legId: leg.id, recheckedOdds: leg.odds }))
  );
  const plan = scan.plan;
  const nowIso = new Date(options.now ?? Date.now()).toISOString();
  const firstRejection = report.rejections[0];
  const legs: PersistOpportunityLegInput[] =
    plan === null
      ? []
      : scan.candidate.legs.map((leg, index) => {
          const stake = plan.stakes[index] ?? 0;
          return {
            selectionId: leg.id,
            oddsSnapshot: leg.odds,
            ...(stake > 0 ? { stake } : {}),
            guaranteedReturn: stake * leg.odds,
          };
        });

  return {
    eventCanonicalId: scan.candidate.eventId,
    status: report.status as PersistOpportunityInput["status"],
    ...(firstRejection !== undefined
      ? {
          rejectionReason:
            firstRejection.reason as NonNullable<PersistOpportunityInput["rejectionReason"]>,
        }
      : {}),
    marketStructure: scan.candidate.structureType,
    opportunityKey: computeOpportunityKey({
      eventCanonicalId: scan.candidate.eventId,
      structureType: scan.candidate.structureType,
      selectionIds: scan.candidate.legs.map((leg) => leg.id),
    }),
    ...(plan !== null
      ? {
          totalStake: plan.totalStake,
          minReturn: plan.minReturn,
          guaranteedProfit: plan.guaranteedProfit,
          roi: plan.roi,
          worstState: `min return ${plan.minReturn.toFixed(4)} over ${plan.stateReturns.length} state(s)`,
        }
      : {}),
    engineVersion: ENGINE_VERSION,
    normalizerVersion: "1",
    settlementVersion: "1",
    optimizerVersion: "1",
    detectedAt: nowIso,
    legs,
    audit: [
      {
        action: "OPPORTUNITY_VALIDATED",
        actor: ENGINE_VERSION,
        detail: {
          structureType: scan.candidate.structureType,
          status: report.status,
          reasons: report.rejections.map((failure) => ({
            reason: failure.reason,
            detail: failure.detail,
          })),
        },
      },
    ],
  };
}

/**
 * Runs one detection pass over the store's current priced selections. Every
 * `ARB` scan is validated and its outcome persisted (verified, theoretical,
 * stale or rejected); non-ARB scans are structural non-events and skipped.
 */
export async function runDetection(
  store: WorkerStore,
  options: DetectionOptions = {}
): Promise<DetectionReport> {
  const now = options.now ?? Date.now();
  const rows = await store.loadPricedSelections();
  const priced = rows.map(toPricedSelection);
  const scans = scanCandidates(priced, {
    allowSameBookmaker: false,
    ...(options.minEventConfidence !== undefined
      ? { minEventConfidence: options.minEventConfidence }
      : {}),
    ...(options.maxAgeMs !== undefined ? { maxAgeMs: options.maxAgeMs } : {}),
    now,
  });
  const arbs = scans.filter((scan) => scan.status === "ARB");
  const opportunities = arbs.map((scan) => toOpportunity(scan, { ...options, now }));

  for (const opportunity of opportunities) {
    await store.persistOpportunity(opportunity);
  }

  return {
    priced: priced.length,
    scans: scans.length,
    arbs: arbs.length,
    opportunities,
  };
}