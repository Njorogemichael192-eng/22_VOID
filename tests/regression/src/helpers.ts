import type { ArbitrageLeg, PricedSelection } from "@22void/arbitrage";
import type { MarketType } from "@22void/domain";
import type { RegressionLeg } from "../../../tests/fixtures/regression/index.js";

/** Map a fixture leg onto the coverage engine's arbitrage leg type. */
export function toArbitrageLeg(leg: RegressionLeg): ArbitrageLeg {
  return {
    id: leg.id,
    ...(leg.bookmaker !== undefined ? { bookmaker: leg.bookmaker } : {}),
    selection: {
      family: leg.family,
      marketType: leg.marketType as MarketType,
      period: leg.period,
      ...(leg.participant !== undefined ? { participant: leg.participant } : {}),
      ...(leg.line !== undefined ? { line: leg.line } : {}),
      outcome: leg.outcome,
    },
    odds: leg.odds,
  };
}

/** Map a fixture leg onto a priced selection for candidate generation. */
export function toPricedSelection(leg: RegressionLeg): PricedSelection {
  return {
    id: leg.id,
    eventId: leg.eventId,
    selection: {
      family: leg.family,
      marketType: leg.marketType as MarketType,
      period: leg.period,
      ...(leg.participant !== undefined ? { participant: leg.participant } : {}),
      ...(leg.line !== undefined ? { line: leg.line } : {}),
      outcome: leg.outcome,
    },
    odds: leg.odds,
    bookmaker: leg.bookmaker,
    ...(leg.observedAt !== undefined ? { observedAt: leg.observedAt } : {}),
    ...(leg.sourceUpdatedAt !== undefined ? { sourceUpdatedAt: leg.sourceUpdatedAt } : {}),
    ...(leg.eventConfidence !== undefined ? { eventConfidence: leg.eventConfidence } : {}),
    ...(leg.settlementConfidence !== undefined ? { settlementConfidence: leg.settlementConfidence } : {}),
    ...(leg.sourceStatus !== undefined ? { sourceStatus: leg.sourceStatus } : {}),
  };
}

/**
 * A reference "now" that keeps every freshness-marked fixture leg young:
 * two minutes after the newest supplier timestamp.
 */
export function referenceNow(legs: readonly RegressionLeg[]): number {
  const stamps = legs
    .map((leg) =>
      leg.sourceUpdatedAt !== undefined ? Date.parse(leg.sourceUpdatedAt) : Number.NaN
    )
    .filter((stamp) => Number.isFinite(stamp));
  const latest = Math.max(...stamps);
  return Number.isFinite(latest) ? latest + 120_000 : Date.now();
}