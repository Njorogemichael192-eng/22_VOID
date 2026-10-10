/**
 * Detection job (Phase 14).
 *
 * Reads the freshly persisted priced selections, applies spec §55 bookmaker
 * price selection per generation group, runs the Phase 10 candidate pipeline
 * (`scanCandidates`) and validates every `ARB` scan with the Phase 11 validator
 * (spec §38–§40). The final recheck (§39) is served by the same cycle: the
 * prices persisted this cycle *are* the current prices, so the recheck is the
 * self-consistent `VERIFIED_ARB` path unless validation rejects the
 * opportunity for freshness/confidence reasons.
 *
 * Opportunities that survive are translated into the persistence input the
 * store writes (opportunity + legs + audit trail), stamped with the recheck
 * timestamp and the freshness horizon they were judged against. Rejected/
 * theoretical outcomes are also persisted with their structured reason - a
 * silent drop would violate the audit principle (spec §66).
 */

import {
  bestPricePerSelection,
  DEFAULT_MAX_CANDIDATES,
  isSourceAvailable,
  type PricedSelection,
  scanCandidates,
  type CandidateScan,
  validateCandidate,
  type ValidationOptions,
} from "@22void/arbitrage";
import { DEFAULT_FRESHNESS_POLICY } from "@22void/domain";
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
  /** Hard cap on generated candidates (default `DEFAULT_MAX_CANDIDATES`). */
  maxCandidates?: number;
}

export interface DetectionSummary {
  priced: number;
  scans: number;
  /** True when generation reached `maxCandidates`, so the search was truncated. */
  capped: boolean;
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
            participant: row.participant as NonNullable<
              PricedSelection["selection"]["participant"]
            >,
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

/** True when two priced selections target the same canonical selection. */
function sameSelection(a: PricedSelection, b: PricedSelection): boolean {
  const left = a.selection;
  const right = b.selection;
  return (
    left.family === right.family &&
    left.marketType === right.marketType &&
    left.period === right.period &&
    (left.participant ?? null) === (right.participant ?? null) &&
    (left.line ?? null) === (right.line ?? null) &&
    left.outcome === right.outcome
  );
}

/**
 * Spec §55 bookmaker price selection, applied per generation group
 * (`eventId|period`).
 *
 * The engine's selection key is not event-scoped, so `bestPricePerSelection`
 * has to run one group at a time - a flat call would collapse every event's
 * `HOME` price into a single entry.
 *
 * Ties at the best price are resolved toward a bookmaker the group has not
 * taken yet. `bestPricePerSelection` keeps the first entry it sees, so a market
 * where the same books lead two outcomes picks one book twice and the §34
 * cross-book policy then prunes the only candidate - surfacing zero
 * opportunities instead of one. When no tie exists the original winner is kept
 * and §34 decides, as it must.
 */
function bestPricePerGenerationGroup(priced: readonly PricedSelection[]): PricedSelection[] {
  const groups = new Map<string, PricedSelection[]>();
  for (const entry of priced) {
    const key = `${entry.eventId}|${entry.selection.period}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [entry]);
    else group.push(entry);
  }

  return [...groups.values()].flatMap((group) => {
    const winners = bestPricePerSelection(group);
    const taken = new Set<string>();
    return winners.map((winner) => {
      if (!taken.has(winner.bookmaker)) {
        taken.add(winner.bookmaker);
        return winner;
      }
      // Prefer an equally-priced entry from a valid source: a tie at the best
      // price must not hand the leg to a down provider when a healthy one quotes
      // the same number, or the fallback above would be undone by the tie-break.
      const tied = (entry: PricedSelection): boolean =>
        entry.odds === winner.odds && !taken.has(entry.bookmaker) && sameSelection(entry, winner);
      const tie =
        group.find((entry) => tied(entry) && isSourceAvailable(entry.sourceStatus)) ??
        group.find(tied);
      const pick = tie ?? winner;
      taken.add(pick.bookmaker);
      return pick;
    });
  });
}

function toOpportunity(scan: CandidateScan, options: DetectionOptions): PersistOpportunityInput {
  const now = options.now ?? Date.now();
  const report = validateCandidate(
    scan,
    scan.candidate.legs,
    { ...(options as ValidationOptions), now },
    scan.candidate.legs.map((leg) => ({ legId: leg.id, recheckedOdds: leg.odds }))
  );
  const plan = scan.plan;
  const nowIso = new Date(now).toISOString();
  const firstRejection = report.rejections[0];
  // The recheck window (§38) closes `maxAgeMs` after the oldest leg was taken,
  // so a candidate already past the horizon carries an `expiresAt` in the past -
  // which is exactly what `explain` reads as "prices are no longer guaranteed
  // fresh". `validatedAt` is the instant the §39 recheck compared prices.
  const policy = options.freshnessPolicy ?? DEFAULT_FRESHNESS_POLICY;
  const maxAgeMs = options.maxAgeMs ?? policy.agingMs;
  const expiresAt = new Date(now - (report.freshness.oldestAgeMs ?? 0) + maxAgeMs).toISOString();
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
          rejectionReason: firstRejection.reason as NonNullable<
            PersistOpportunityInput["rejectionReason"]
          >,
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
    ...(report.recheck.status !== "NOT_RUN" ? { validatedAt: report.recheck.comparedAt } : {}),
    expiresAt,
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
  const selected = bestPricePerGenerationGroup(priced);
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const scans = scanCandidates(selected, {
    allowSameBookmaker: false,
    // `generateCandidates` stops as soon as it reaches this, so an exact match
    // means the search space was cut short rather than exhausted.
    maxCandidates,
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
    capped: scans.length >= maxCandidates,
    arbs: arbs.length,
    opportunities,
  };
}
