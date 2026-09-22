/**
 * Canonical domain value sets for 22_VOID.
 *
 * These are the single source of truth for statuses, settlement results and
 * market taxonomy. Engine packages must agree on these strings; see
 * docs/ARBITRAGE_ENGINE_SPEC.md for the full semantics.
 */

import { z } from "zod";

/** Widen a non-empty value set to a zod-enum-compatible tuple. */
function valueTuple<T extends string>(values: readonly T[]): readonly [T, ...T[]] {
  if (values.length === 0) {
    throw new Error("value set must not be empty");
  }
  return values as unknown as readonly [T, ...T[]];
}

export const SettlementResult = {
  FULL_WIN: "FULL_WIN",
  FULL_LOSS: "FULL_LOSS",
  PUSH: "PUSH",
  HALF_WIN: "HALF_WIN",
  HALF_LOSS: "HALF_LOSS",
  VOID: "VOID",
} as const;
export type SettlementResult = (typeof SettlementResult)[keyof typeof SettlementResult];
export const SETTLEMENT_RESULT_VALUES = valueTuple(Object.values(SettlementResult));
export const settlementResultSchema = z.enum(SETTLEMENT_RESULT_VALUES);

/** Lower-level component result used by quarter-line splitting (§9). */
export const ComponentResult = {
  WIN: "WIN",
  LOSS: "LOSS",
  PUSH: "PUSH",
  VOID: "VOID",
} as const;
export type ComponentResult = (typeof ComponentResult)[keyof typeof ComponentResult];
export const COMPONENT_RESULT_VALUES = valueTuple(Object.values(ComponentResult));
export const componentResultSchema = z.enum(COMPONENT_RESULT_VALUES);

/** Age-band classification of a price (§38). */
export const ScoreFreshness = {
  FRESH: "FRESH",
  AGING: "AGING",
  STALE: "STALE",
} as const;
export type ScoreFreshness = (typeof ScoreFreshness)[keyof typeof ScoreFreshness];
export const SCORE_FRESHNESS_VALUES = valueTuple(Object.values(ScoreFreshness));
export const scoreFreshnessSchema = z.enum(SCORE_FRESHNESS_VALUES);

/** Lifecycle status of an opportunity/candidate (§40). */
export const OpportunityStatus = {
  DETECTED: "DETECTED",
  VALIDATING: "VALIDATING",
  THEORETICAL_ARB: "THEORETICAL_ARB",
  FRESH_ARB: "FRESH_ARB",
  VERIFIED_ARB: "VERIFIED_ARB",
  STALE: "STALE",
  INVALIDATED: "INVALIDATED",
  REJECTED: "REJECTED",
} as const;
export type OpportunityStatus = (typeof OpportunityStatus)[keyof typeof OpportunityStatus];
export const OPPORTUNITY_STATUS_VALUES = valueTuple(Object.values(OpportunityStatus));
export const opportunityStatusSchema = z.enum(OPPORTUNITY_STATUS_VALUES);

/** Structured rejection reasons (§40, §71). */
export const RejectionReason = {
  UNKNOWN_SETTLEMENT: "UNKNOWN_SETTLEMENT",
  EVENT_MISMATCH: "EVENT_MISMATCH",
  EVENT_MATCH_FAILED: "EVENT_MATCH_FAILED",
  EVENT_MATCH_UNCERTAIN: "EVENT_MATCH_UNCERTAIN",
  PERIOD_MISMATCH: "PERIOD_MISMATCH",
  NON_EXHAUSTIVE: "NON_EXHAUSTIVE",
  NON_EXCLUSIVE: "NON_EXCLUSIVE",
  BOTH_LOSS_STATE: "BOTH_LOSS_STATE",
  NEGATIVE_GUARANTEED_PROFIT: "NEGATIVE_GUARANTEED_PROFIT",
  STALE_ODDS: "STALE_ODDS",
  INVALID_ODDS: "INVALID_ODDS",
  INVALID_ODDS_PAYLOAD: "INVALID_ODDS_PAYLOAD",
  INVALID_MARKET: "INVALID_MARKET",
  UNSUPPORTED_MARKET: "UNSUPPORTED_MARKET",
  NO_STATE_MODEL: "NO_STATE_MODEL",
  INCOMPLETE_COVERAGE: "INCOMPLETE_COVERAGE",
  STAKE_LIMIT: "STAKE_LIMIT",
  ROUNDING_DESTROYS_PROFIT: "ROUNDING_DESTROYS_PROFIT",
  OPTIMIZATION_FAILED: "OPTIMIZATION_FAILED",
  PROVIDER_ERROR: "PROVIDER_ERROR",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  /** Phase 11: attested settlement confidence below the verification floor. */
  SETTLEMENT_CONFIDENCE_LOW: "SETTLEMENT_CONFIDENCE_LOW",
  /** Phase 11: source `sourceUpdatedAt` timestamps too far apart (§38 cross-source). */
  CROSS_SOURCE_TIMESTAMP_SPREAD: "CROSS_SOURCE_TIMESTAMP_SPREAD",
  /** Phase 11: the final recheck found the price had moved (§39). */
  PRICE_CHANGED_ON_RECHECK: "PRICE_CHANGED_ON_RECHECK",
  /** Phase 11: a candidate cannot be verified because provenance is missing or unwritten. */
  INSUFFICIENT_PROVENANCE: "INSUFFICIENT_PROVENANCE",
} as const;
export type RejectionReason = (typeof RejectionReason)[keyof typeof RejectionReason];
export const REJECTION_REASON_VALUES = valueTuple(Object.values(RejectionReason));
export const rejectionReasonSchema = z.enum(REJECTION_REASON_VALUES);

/** Canonical market families (§5). */
export const MarketFamily = {
  MATCH_RESULT: "MATCH_RESULT",
  DOUBLE_CHANCE: "DOUBLE_CHANCE",
  MATCH_TOTAL: "MATCH_TOTAL",
  ASIAN_TOTAL: "ASIAN_TOTAL",
  ASIAN_HANDICAP: "ASIAN_HANDICAP",
  TEAM_TOTAL: "TEAM_TOTAL",
  TEAM_ASIAN_TOTAL: "TEAM_ASIAN_TOTAL",
  CORNERS: "CORNERS",
  CARDS: "CARDS",
  BTTS: "BTTS",
  EXACT_SCORE: "EXACT_SCORE",
} as const;
export type MarketFamily = (typeof MarketFamily)[keyof typeof MarketFamily];
export const MARKET_FAMILY_VALUES = valueTuple(Object.values(MarketFamily));
export const marketFamilySchema = z.enum(MARKET_FAMILY_VALUES);

/** Match period a market refers to (§8). */
export const Period = {
  FULL_MATCH: "FULL_MATCH",
  FIRST_HALF: "FIRST_HALF",
  SECOND_HALF: "SECOND_HALF",
  EXTRA_TIME: "EXTRA_TIME",
  PENALTIES: "PENALTIES",
} as const;
export type Period = (typeof Period)[keyof typeof Period];
export const PERIOD_VALUES = valueTuple(Object.values(Period));
export const periodSchema = z.enum(PERIOD_VALUES);

/** Outcome of a selection within a market family. */
export const SelectionOutcome = {
  HOME: "HOME",
  DRAW: "DRAW",
  AWAY: "AWAY",
  OVER: "OVER",
  UNDER: "UNDER",
  BTTS_YES: "BTTS_YES",
  BTTS_NO: "BTTS_NO",
  HOME_OR_DRAW: "HOME_OR_DRAW",
  AWAY_OR_DRAW: "AWAY_OR_DRAW",
  HOME_OR_AWAY: "HOME_OR_AWAY",
} as const;
export type SelectionOutcome = (typeof SelectionOutcome)[keyof typeof SelectionOutcome];
export const SELECTION_OUTCOME_VALUES = valueTuple(Object.values(SelectionOutcome));
export const selectionOutcomeSchema = z.enum(SELECTION_OUTCOME_VALUES);

/** Team-relative side a participant market refers to. */
export const Participant = {
  HOME: "HOME",
  AWAY: "AWAY",
} as const;
export type Participant = (typeof Participant)[keyof typeof Participant];
export const PARTICIPANT_VALUES = valueTuple(Object.values(Participant));
export const participantSchema = z.enum(PARTICIPANT_VALUES);

/** Lifecycle status of a canonical event. */
export const EventStatus = {
  SCHEDULED: "SCHEDULED",
  LIVE: "LIVE",
  FINISHED: "FINISHED",
  POSTPONED: "POSTPONED",
  CANCELLED: "CANCELLED",
  ABANDONED: "ABANDONED",
  UNKNOWN: "UNKNOWN",
} as const;
export type EventStatus = (typeof EventStatus)[keyof typeof EventStatus];
export const EVENT_STATUS_VALUES = valueTuple(Object.values(EventStatus));
export const eventStatusSchema = z.enum(EVENT_STATUS_VALUES);
