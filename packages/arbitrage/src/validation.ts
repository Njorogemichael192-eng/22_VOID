/**
 * Opportunity validation (BUILD_AGENT_PROMPT Phase 11, spec §5 Rule 5, §38–§40).
 *
 * Phase 10 returns `ARB` / `NO_ARB` / `REJECTED` / `PRUNED` scan verdicts from
 * the state model and stake optimizer. That establishes *existence* of a
 * mathematical arb (`min return > T`); it says nothing about whether the prices
 * can be trusted *now*. This module decides what an `ARB` scan may become as a
 * live opportunity. Nothing is promoted to `VERIFIED_ARB` without all of:
 *
 *  1. freshness threshold     — the per-price age classification (§38) and an
 *                               absolute staleness horizon (Rule 5);
 *  2. provider/source status  — every leg's supplier must be available;
 *  3. event confidence        — the canonical event identity must be attested
 *                               above a verification floor (Phase 4);
 *  4. settlement confidence   — the settlement rule must be attested above a
 *                               floor (settlement rules are never assumed);
 *  5. price age               — each leg within `maxAgeMs`;
 *  6. cross-source consistency — the legs' `sourceUpdatedAt` timestamps must be
 *                               roughly contemporaneous;
 *  7. final recheck           — the current prices are re-fetched and compared
 *                               before display (§39). A price that moved beyond
 *                               tolerance invalidates the opportunity.
 *
 * The theoretical/verified distinction (§40) is the crux: a positive minimum
 * return only establishes `THEORETICAL_ARB`. Promotion to `VERIFIED_ARB`
 * requires every check above, and a completed recheck with no moved prices.
 *
 * Status decision for an `ARB` scan:
 *
 * ```text
 * recheck changed           -> INVALIDATED  (PRICE_CHANGED_ON_RECHECK)
 * recheck incomplete        -> INVALIDATED  (PROVIDER_UNAVAILABLE)
 * provenance missing        -> THEORETICAL_ARB (rule 5: no attestation)
 * any price stale           -> STALE
 * confidence/source/spread  -> REJECTED      (structured reasons, §41)
 * all checks pass:
 *   recheck ran and OK      -> VERIFIED_ARB
 *   recheck not run         -> FRESH_ARB     (fresh but unverified)
 * ```
 */

import {
  classifyFreshness,
  DEFAULT_FRESHNESS_POLICY,
  OpportunityStatus,
  RejectionReason,
} from "@22void/domain";
import type { FreshnessPolicy, ScoreFreshness } from "@22void/domain";

import type { CandidateScan, PricedSelection, PruneReason } from "./candidates";

export interface ValidationOptions {
  /** Age-band policy for the per-price freshness classification (§38). */
  readonly freshnessPolicy?: FreshnessPolicy;
  /** Absolute staleness horizon in ms (default `freshnessPolicy.agingMs`). */
  readonly maxAgeMs?: number;
  /** Event-identity confidence floor required to verify (default 0.8). */
  readonly minEventConfidence?: number;
  /** Settlement-rule confidence floor required to verify (default 0.8). */
  readonly minSettlementConfidence?: number;
  /** Max spread between any two legs' `sourceUpdatedAt` in ms (default 60s). */
  readonly maxSourceSpreadMs?: number;
  /** Relative odds change beyond which a recheck invalidates (default 0.001). */
  readonly recheckTolerance?: number;
  /** Clock override (default `Date.now()`). */
  readonly now?: number;
}

/** Per-leg validation detail. */
export interface LegValidation {
  legId: string;
  provider?: string;
  bookmaker?: string;
  /** Validated price age in ms, or `null` when the leg has no timestamp. */
  ageMs: number | null;
  /** Freshness band for the leg's age (§38), or `null` when unknown. */
  freshness: ScoreFreshness | null;
  /** True when the age is known and within `maxAgeMs`. */
  priceAgePass: boolean;
  /** True when the supplier is usable; `null` when not attested. */
  sourcePass: boolean | null;
  /** Attested event confidence, or `null` when not supplied. */
  eventConfidence: number | null;
  /** True when attested and at/above the verification floor; `null` when not. */
  eventConfidencePass: boolean | null;
  /** Attested settlement confidence, or `null` when not supplied. */
  settlementConfidence: number | null;
  /** True when attested and at/above the verification floor; `null` when not. */
  settlementConfidencePass: boolean | null;
  /** The staleness horizon applied to this leg. */
  maxAgeMs: number;
}

/** A structured reason an opportunity failed validation (§41). */
export interface ValidationFailure {
  reason: RejectionReason;
  detail: string;
  legIds?: string[];
  count?: number;
}

/** Cross-source timestamp consistency summary (§38). */
export interface CrossSourceConsistency {
  /** True when every leg carries a parseable `sourceUpdatedAt`. */
  evaluateble: boolean;
  /** Earliest `sourceUpdatedAt` across the legs (ISO), if evaluable. */
  minSource: string | null;
  /** Latest `sourceUpdatedAt` across the legs (ISO), if evaluable. */
  maxSource: string | null;
  /** Spread between the two extremes in ms, if evaluable. */
  spreadMs: number | null;
  /** True when evaluable and within the configured tolerance. */
  pass: boolean;
}

export type RecheckStatus = "NOT_RUN" | "OK" | "CHANGED";

/** One price fetched by the final recheck (§39). */
export interface RecheckedPrice {
  legId: string;
  recheckedOdds: number;
}

/** A leg whose price moved beyond the recheck tolerance (§39). */
export interface RecheckChange {
  legId: string;
  priorOdds: number;
  currentOdds: number;
  /** `|current - prior| / prior`. */
  delta: number;
}

export interface RecheckResult {
  status: RecheckStatus;
  /** Legs whose price moved beyond tolerance. */
  changed: RecheckChange[];
  /** False when the recheck did not return a price for every leg. */
  covering: boolean;
  tolerance: number;
  /** ISO timestamp of the comparison. */
  comparedAt: string;
}

export interface ValidationReport {
  /** Terminal lifecycle status for the opportunity (§40). */
  status: OpportunityStatus;
  /** The scan being validated. */
  scan: CandidateScan;
  /** Per-leg validation detail. */
  legs: LegValidation[];
  /** True when every leg carries attestable provenance. */
  hasValidationInput: boolean;
  /** True when the optimization establishes a positive minimum return. */
  theoretical: boolean;
  /** True exactly when `status === VERIFIED_ARB`. */
  verified: boolean;
  /** Candidate-level price-age/freshness summary. */
  freshness: {
    /** True when every leg's age is known and within the horizon. */
    pass: boolean;
    /** Oldest age across the legs, or `null` when unknown. */
    oldestAgeMs: number | null;
    /** Distinct freshness bands present on the legs. */
    bands: ScoreFreshness[];
  };
  sources: { pass: boolean };
  eventConfidence: { pass: boolean };
  settlementConfidence: { pass: boolean };
  crossSource: CrossSourceConsistency;
  recheck: RecheckResult;
  /** Every reason the candidate is not `VERIFIED_ARB` (§41). */
  rejections: ValidationFailure[];
}

interface LegOptions {
  policy: FreshnessPolicy;
  maxAgeMs: number;
  minEventConfidence: number;
  minSettlementConfidence: number;
}

/** Age of a price: `now - sourceUpdatedAt`, falling back to `observedAt` (§38). */
export function priceAge(leg: PricedSelection, now: number): number | null {
  const source = leg.sourceUpdatedAt !== undefined ? Date.parse(leg.sourceUpdatedAt) : Number.NaN;
  if (Number.isFinite(source)) return Math.max(0, now - source);
  const observed =
    leg.observedAt !== undefined && Number.isFinite(leg.observedAt) ? leg.observedAt : Number.NaN;
  if (Number.isFinite(observed)) return Math.max(0, now - observed);
  return null;
}

/** `|current - prior| / prior` relative price delta. */
export function relativeDelta(priorOdds: number, currentOdds: number): number {
  return Math.abs(currentOdds - priorOdds) / priorOdds;
}

function buildLegValidation(leg: PricedSelection, options: LegOptions, now: number): LegValidation {
  const ageMs = priceAge(leg, now);
  return {
    legId: leg.id,
    ...(leg.provider !== undefined ? { provider: leg.provider } : {}),
    ...(leg.bookmaker !== undefined ? { bookmaker: leg.bookmaker } : {}),
    ageMs,
    freshness: ageMs === null ? null : classifyFreshness(ageMs, options.policy),
    priceAgePass: ageMs !== null && ageMs <= options.maxAgeMs,
    sourcePass:
      leg.sourceStatus === undefined
        ? null
        : leg.sourceStatus === "OK" || leg.sourceStatus === "DEGRADED",
    eventConfidence: leg.eventConfidence ?? null,
    eventConfidencePass:
      leg.eventConfidence === undefined ? null : leg.eventConfidence >= options.minEventConfidence,
    settlementConfidence: leg.settlementConfidence ?? null,
    settlementConfidencePass:
      leg.settlementConfidence === undefined
        ? null
        : leg.settlementConfidence >= options.minSettlementConfidence,
    maxAgeMs: options.maxAgeMs,
  };
}

function evaluateCrossSource(
  legs: readonly PricedSelection[],
  maxSpreadMs: number
): CrossSourceConsistency {
  const stamps = legs
    .map((leg) =>
      leg.sourceUpdatedAt !== undefined ? Date.parse(leg.sourceUpdatedAt) : Number.NaN
    )
    .filter((stamp) => Number.isFinite(stamp));
  if (stamps.length !== legs.length || stamps.length === 0) {
    return { evaluateble: false, minSource: null, maxSource: null, spreadMs: null, pass: false };
  }
  const min = Math.min(...stamps);
  const max = Math.max(...stamps);
  return {
    evaluateble: true,
    minSource: new Date(min).toISOString(),
    maxSource: new Date(max).toISOString(),
    spreadMs: max - min,
    pass: max - min <= maxSpreadMs,
  };
}

/**
 * Compares the previously observed prices against the recheck's current prices
 * (§39). A leg missing from `rechecked` is not confirmed and makes the recheck
 * non-covering (the caller must treat that as a failed recheck).
 */
export function compareRecheckedPrices(
  legs: readonly PricedSelection[],
  rechecked: readonly RecheckedPrice[],
  tolerance: number,
  now: number = Date.now()
): RecheckResult {
  const byId = new Map(rechecked.map((entry) => [entry.legId, entry.recheckedOdds]));
  const changed: RecheckChange[] = [];
  for (const leg of legs) {
    const current = byId.get(leg.id);
    if (current === undefined) continue;
    const delta = relativeDelta(leg.odds, current);
    if (delta > tolerance) {
      changed.push({ legId: leg.id, priorOdds: leg.odds, currentOdds: current, delta });
    }
  }
  return {
    status: changed.length > 0 ? "CHANGED" : "OK",
    changed,
    covering: legs.every((leg) => byId.has(leg.id)),
    tolerance,
    comparedAt: new Date(now).toISOString(),
  };
}

function notRun(now: number, tolerance: number): RecheckResult {
  return {
    status: "NOT_RUN",
    changed: [],
    covering: true,
    tolerance,
    comparedAt: new Date(now).toISOString(),
  };
}

function attestable(leg: PricedSelection): boolean {
  return (
    leg.sourceUpdatedAt !== undefined &&
    leg.eventConfidence !== undefined &&
    leg.settlementConfidence !== undefined &&
    leg.sourceStatus !== undefined
  );
}

interface CollectThresholds {
  minEventConfidence: number;
  minSettlementConfidence: number;
}

function collectFailures(
  legs: readonly PricedSelection[],
  legValidations: readonly LegValidation[],
  crossSource: CrossSourceConsistency,
  thresholds: CollectThresholds
): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  legValidations.forEach((validation, index) => {
    if (validation.eventConfidencePass === false) {
      failures.push({
        reason: RejectionReason.EVENT_MATCH_UNCERTAIN,
        detail: `leg ${validation.legId} event confidence ${validation.eventConfidence} < ${thresholds.minEventConfidence}`,
        legIds: [validation.legId],
      });
    }
    if (validation.settlementConfidencePass === false) {
      failures.push({
        reason: RejectionReason.SETTLEMENT_CONFIDENCE_LOW,
        detail: `leg ${validation.legId} settlement confidence ${validation.settlementConfidence} < ${thresholds.minSettlementConfidence}`,
        legIds: [validation.legId],
      });
    }
    if (validation.sourcePass === false) {
      const status = legs[index]?.sourceStatus ?? "(unknown)";
      failures.push({
        reason: RejectionReason.PROVIDER_UNAVAILABLE,
        detail: `leg ${validation.legId} source status "${status}" is not usable`,
        legIds: [validation.legId],
      });
    }
  });
  if (crossSource.evaluateble && !crossSource.pass) {
    failures.push({
      reason: RejectionReason.CROSS_SOURCE_TIMESTAMP_SPREAD,
      detail: `source timestamps span ${crossSource.spreadMs}ms (${crossSource.minSource} .. ${crossSource.maxSource})`,
      legIds: legs.map((leg) => leg.id),
    });
  }
  return failures;
}

const PRUNE_TO_REJECTION: { readonly [Reason in PruneReason]: RejectionReason } = {
  CANDIDATE_SIZE: RejectionReason.INVALID_MARKET,
  EVENT_MISMATCH: RejectionReason.EVENT_MISMATCH,
  PERIOD_MISMATCH: RejectionReason.PERIOD_MISMATCH,
  DUPLICATE_SELECTION: RejectionReason.INVALID_MARKET,
  INVALID_ODDS: RejectionReason.INVALID_ODDS,
  SUSPENDED: RejectionReason.INVALID_MARKET,
  STALE_ODDS: RejectionReason.STALE_ODDS,
  SAME_BOOKMAKER: RejectionReason.STAKE_LIMIT,
  EVENT_UNCERTAIN: RejectionReason.EVENT_MATCH_UNCERTAIN,
  INCOMPATIBLE_MARKET: RejectionReason.UNSUPPORTED_MARKET,
  PRICE_PREFILTER: RejectionReason.NEGATIVE_GUARANTEED_PROFIT,
};

function mapPruneReason(reason: PruneReason): RejectionReason {
  return PRUNE_TO_REJECTION[reason];
}

function formatDelta(delta: number): string {
  return `${(delta * 100).toFixed(3)}%`;
}

/**
 * Validates a Phase 10 scan and classifies which lifecycle status it may hold
 * (§40). `legs` should be the candidate's priced selections (they carry the
 * provenance needed for attestation). `rechecked`, when given, is the result of
 * a final price recheck (§39); without it the maximum status is `FRESH_ARB`.
 */
export function validateCandidate(
  scan: CandidateScan,
  legs: readonly PricedSelection[],
  options: ValidationOptions = {},
  rechecked: readonly RecheckedPrice[] | null = null
): ValidationReport {
  const now = options.now ?? Date.now();
  const policy = options.freshnessPolicy ?? DEFAULT_FRESHNESS_POLICY;
  const maxAgeMs = options.maxAgeMs ?? policy.agingMs;
  const minEventConfidence = options.minEventConfidence ?? 0.8;
  const minSettlementConfidence = options.minSettlementConfidence ?? 0.8;
  const maxSourceSpreadMs = options.maxSourceSpreadMs ?? 60_000;
  const tolerance = options.recheckTolerance ?? 0.001;

  const legValidations = legs.map((leg) =>
    buildLegValidation(leg, { policy, maxAgeMs, minEventConfidence, minSettlementConfidence }, now)
  );
  const crossSource = evaluateCrossSource(legs, maxSourceSpreadMs);
  const recheckResult =
    rechecked !== null
      ? compareRecheckedPrices(legs, rechecked, tolerance, now)
      : notRun(now, tolerance);

  const provenance = legs.every(attestable);
  const theoretical = scan.plan?.isArb === true;

  const rejections: ValidationFailure[] = [];
  let status: OpportunityStatus;

  if (scan.status !== "ARB") {
    status = OpportunityStatus.REJECTED;
    if (scan.status === "NO_ARB" && scan.plan !== null) {
      rejections.push({
        reason: RejectionReason.NEGATIVE_GUARANTEED_PROFIT,
        detail: `min return ${scan.plan.minReturn} <= total stake ${scan.plan.totalStake}`,
      });
    } else if (scan.status === "REJECTED" && scan.coverage !== null) {
      for (const verdict of scan.coverage.rejections) {
        rejections.push({
          reason: verdict.reason,
          detail: verdict.detail,
          ...(verdict.evidence.legIds !== undefined ? { legIds: verdict.evidence.legIds } : {}),
          ...(verdict.evidence.count !== undefined ? { count: verdict.evidence.count } : {}),
        });
      }
    } else if (scan.status === "PRUNED") {
      for (const verdict of scan.pruning.verdicts) {
        rejections.push({
          reason: mapPruneReason(verdict.reason),
          detail: verdict.detail,
          ...(verdict.legIds !== undefined ? { legIds: verdict.legIds } : {}),
        });
      }
    }
  } else if (recheckResult.status === "CHANGED") {
    status = OpportunityStatus.INVALIDATED;
    for (const change of recheckResult.changed) {
      rejections.push({
        reason: RejectionReason.PRICE_CHANGED_ON_RECHECK,
        detail: `leg ${change.legId} moved ${change.priorOdds} -> ${change.currentOdds} (${formatDelta(change.delta)})`,
        legIds: [change.legId],
      });
    }
  } else if (rechecked !== null && !recheckResult.covering) {
    status = OpportunityStatus.INVALIDATED;
    rejections.push({
      reason: RejectionReason.PROVIDER_UNAVAILABLE,
      detail: "final recheck did not return a current price for every leg",
    });
  } else if (!provenance) {
    status = OpportunityStatus.THEORETICAL_ARB;
    const missing = legs.filter((leg) => !attestable(leg)).map((leg) => leg.id);
    rejections.push({
      reason: RejectionReason.INSUFFICIENT_PROVENANCE,
      detail: `legs lack attestable provenance (source timestamp / event confidence / settlement confidence / source status): ${missing.join(", ")}`,
      legIds: missing,
    });
  } else {
    const stale = legValidations.some((validation) => !validation.priceAgePass);
    if (stale) {
      status = OpportunityStatus.STALE;
      for (const validation of legValidations) {
        if (!validation.priceAgePass) {
          rejections.push({
            reason: RejectionReason.STALE_ODDS,
            detail: `leg ${validation.legId} age ${validation.ageMs}ms > ${maxAgeMs}ms (freshness ${validation.freshness ?? "unknown"})`,
            legIds: [validation.legId],
          });
        }
      }
    } else {
      const failures = collectFailures(legs, legValidations, crossSource, {
        minEventConfidence,
        minSettlementConfidence,
      });
      if (failures.length > 0) {
        status = OpportunityStatus.REJECTED;
        rejections.push(...failures);
      } else if (recheckResult.status === "OK") {
        status = OpportunityStatus.VERIFIED_ARB;
      } else {
        status = OpportunityStatus.FRESH_ARB;
      }
    }
  }

  const knownAges = legValidations
    .map((validation) => validation.ageMs)
    .filter((age): age is number => age !== null);
  const bands = [
    ...new Set(
      legValidations
        .map((validation) => validation.freshness)
        .filter((freshness): freshness is ScoreFreshness => freshness !== null)
    ),
  ];

  return {
    status,
    scan,
    legs: legValidations,
    hasValidationInput: provenance,
    theoretical,
    verified: status === OpportunityStatus.VERIFIED_ARB,
    freshness: {
      pass: legValidations.every((validation) => validation.priceAgePass),
      oldestAgeMs: knownAges.length > 0 ? Math.max(...knownAges) : null,
      bands,
    },
    sources: { pass: legValidations.every((validation) => validation.sourcePass === true) },
    eventConfidence: {
      pass: legValidations.every((validation) => validation.eventConfidencePass === true),
    },
    settlementConfidence: {
      pass: legValidations.every((validation) => validation.settlementConfidencePass === true),
    },
    crossSource,
    recheck: recheckResult,
    rejections,
  };
}

/** Renders the validation verdict as a multi-line explanation (Rule 6). */
export function formatValidationReport(report: ValidationReport): string {
  const lines = [
    `validated ${report.status} (${report.legs.length} legs)`,
    `theoretical=${report.theoretical} verified=${report.verified} provenance=${report.hasValidationInput}`,
    `freshness pass=${report.freshness.pass} oldest=${report.freshness.oldestAgeMs}ms bands=[${report.freshness.bands.join(", ")}]`,
    `sources=${report.sources.pass} event=${report.eventConfidence.pass} settlement=${report.settlementConfidence.pass}`,
    `cross-source pass=${report.crossSource.pass} spread=${report.crossSource.spreadMs}ms`,
    `recheck: ${report.recheck.status} (tolerance ${report.recheck.tolerance})`,
  ];
  for (const leg of report.legs) {
    lines.push(
      `- ${leg.legId}: age ${leg.ageMs}ms ${leg.freshness ?? "?"} priceAge=${leg.priceAgePass} event=${leg.eventConfidence ?? "-"} settlement=${leg.settlementConfidence ?? "-"} source=${leg.sourcePass ?? "-"}`
    );
  }
  for (const failure of report.rejections) {
    const suffix = failure.legIds !== undefined ? ` | legs: ${failure.legIds.join(", ")}` : "";
    lines.push(`- ${failure.reason}: ${failure.detail}${suffix}`);
  }
  return lines.join("\n");
}
