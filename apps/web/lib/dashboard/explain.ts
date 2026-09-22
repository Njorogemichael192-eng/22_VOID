/**
 * Evidence text for the dashboard (Phase 13). Every explanation is a pure
 * function of an `@22void/db` opportunity view (plus the current time), so the
 * Render-Every-Fact rule (Rule 6) is testable without a DB: the same inputs
 * always produce the same sections.
 */

import { OpportunityStatus } from "@22void/domain";
import type { OpportunityView } from "@22void/db";

import { formatAge, formatMoney, formatOdds, formatRoi, outcomeLabel } from "./format";

export interface ExplanationSection {
  title: string;
  tone: "positive" | "neutral" | "negative";
  summary: string;
  points: string[];
}

const ARB_STATUSES = new Set<string>([
  OpportunityStatus.VERIFIED_ARB,
  OpportunityStatus.FRESH_ARB,
  OpportunityStatus.THEORETICAL_ARB,
]);

export function isArbStatus(status: string): boolean {
  return ARB_STATUSES.has(status);
}

interface MarketPartLike {
  family: string;
  marketType?: string | null;
  period?: string | null;
  participant?: string | null;
  line?: string | null;
}

/** Human condition a leg needs to win («Over 2.5», «Home wins», «Draw»…). */
export function winCondition(market: MarketPartLike, outcome: string): string {
  const family = market.family;
  const line = market.line ?? null;
  const outcomeName = outcomeLabel(outcome);

  if (outcome === "OVER" || outcome === "UNDER") {
    const subject =
      family === "TEAM_TOTAL" || family === "TEAM_ASIAN_TOTAL"
        ? market.participant === "AWAY"
          ? "away team"
          : "home team"
        : "match";
    return line !== null ? `${outcomeName} ${line} ${subject} totals` : `${outcomeName} totals`;
  }
  if (family === "MATCH_RESULT") {
    if (outcome === "HOME") return "Home win";
    if (outcome === "DRAW") return "Draw";
    if (outcome === "AWAY") return "Away win";
  }
  if (family === "DOUBLE_CHANCE") {
    const map: Record<string, string> = {
      HOME_OR_DRAW: "Home win or draw",
      AWAY_OR_DRAW: "Away win or draw",
      HOME_OR_AWAY: "Any team wins (no draw)",
    };
    return map[outcome] ?? outcome;
  }
  if (family === "BTTS") {
    return outcome === "BTTS_YES" ? "Both teams score" : "At least one team fails to score";
  }
  if (family === "EXACT_SCORE") return `Exact score ${line ?? "?"}`;
  if (outcome === "HOME" || outcome === "AWAY") {
    return `${outcome === "HOME" ? "Home" : "Away"} covers the ${line ?? "level"} line`;
  }
  return line !== null ? `${outcomeName} ${line}` : outcomeName;
}

const STRUCTURE_POINTS: Record<string, { label: string; points: string[] }> = {
  SAME_MARKET_COMPLEMENT: {
    label: "Same-market complement",
    points: [
      "Two selections on the same market with complementary outcomes.",
      "Exactly one of them wins in every settlement state — no third state exists.",
    ],
  },
  COMPLEMENTARY_TOTALS: {
    label: "Complementary totals",
    points: [
      "Two different total lines that still leave no settlement state uncovered.",
      "Whatever the aggregate, at least one leg wins on its own line.",
    ],
  },
  ASIAN_LINE: {
    label: "Asian line hedge",
    points: [
      "Both sides of an Asian handicap / total line are taken.",
      "Quarter lines split into two outcomes, so half-win and half-loss states exist.",
    ],
  },
  PROTECTED_HANDICAP: {
    label: "Protected handicap",
    points: [
      "One side of an Asian handicap is hedged so a half-result cannot lose both legs.",
      "The worst settlement state still leaves one leg winning.",
    ],
  },
  TEAM_TOTAL_MATCH_TOTAL: {
    label: "Team total vs match total",
    points: [
      "A team total is paired with a match total in the same direction.",
      "The team total is a stricter but cheaper way to cover the same result.",
    ],
  },
  PARTITION: {
    label: "Market partition",
    points: ["The selected outcomes partition every possible match result into winning legs."],
  },
  MULTI_LEG_PARTITION: {
    label: "Multi-leg partition",
    points: [
      "Three or more selections whose outcomes jointly cover every settlement state.",
      "More legs mean more bookmakers and higher combined margin risk.",
    ],
  },
  GENERIC: {
    label: "Generic structure",
    points: [
      "The combination is covered by the state model but does not match a named pattern.",
      "Every settlement state still resolves to at least one winning leg.",
    ],
  },
};

export function structureEvidence(structure: string | null): ExplanationSection {
  const known = structure !== null ? STRUCTURE_POINTS[structure] : undefined;
  return {
    title: "Market structure",
    tone: "neutral",
    summary:
      known?.label ??
      "Combination verified against the full outcome-state model (not reciprocal sums alone).",
    points: known?.points ?? [
      "The payoff matrix over every settlement state was computed before this was shown.",
      "A positive minimum return is required, so no single state can lose more than the guarantee.",
    ],
  };
}

export function arbitrageEvidence(opp: OpportunityView): ExplanationSection {
  const total = opp.totalStake ?? 0;
  const profit = opp.guaranteedProfit;
  return {
    title: "Positive guaranteed return",
    tone: "positive",
    summary:
      profit !== null && opp.minReturn !== null
        ? `Total staked ${formatMoney(total)}. Every settlement state returns at least ${formatMoney(
            opp.minReturn
          )} — a guaranteed ${formatMoney(profit)} (${formatRoi(opp.roi)}) no matter the result.`
        : `A positive minimum return was proven for ${formatMoney(total)} staked across ${opp.legs.length} legs.`,
    points: opp.legs.map(
      (leg) =>
        `${leg.bookmaker} — ${winCondition(leg.market, leg.outcome)} at ${formatOdds(
          leg.oddsSnapshot
        )} (stake ${formatMoney(leg.stake)} → at least ${formatMoney(leg.guaranteedReturn)}).`
    ),
  };
}

export function settlementEvidence(opp: OpportunityView): ExplanationSection {
  return {
    title: "Settlement coverage",
    tone: "positive",
    summary:
      "Every possible settlement state of this match is covered by at least one leg; no uncovered state exists.",
    points: opp.legs.map(
      (leg) =>
        `${winCondition(leg.market, leg.outcome)} → ${leg.bookmaker} pays ${formatMoney(
          leg.guaranteedReturn
        )} in that state's worst case.`
    ),
  };
}

const REJECTION_COPY: Record<string, { headline: string; detail: string }> = {
  UNKNOWN_SETTLEMENT: {
    headline: "Settlement is not known",
    detail:
      "A settlement rule could not be resolved for at least one selection, so its win states cannot be proven.",
  },
  EVENT_MISMATCH: {
    headline: "Event identity mismatch",
    detail: "Selections reference different canonical events.",
  },
  EVENT_MATCH_FAILED: {
    headline: "No event match",
    detail: "A provider event could not be matched to a canonical event.",
  },
  EVENT_MATCH_UNCERTAIN: {
    headline: "Event identity uncertain",
    detail:
      "The event match confidence is below the verification floor, so the link between legs is not attested.",
  },
  PERIOD_MISMATCH: {
    headline: "Period mismatch",
    detail: "Legs reference different match periods (for example half vs full time).",
  },
  NON_EXHAUSTIVE: {
    headline: "Uncovered outcomes",
    detail: "Some settlement state has no winning leg — the result space is not fully covered.",
  },
  NON_EXCLUSIVE: {
    headline: "Overlapping outcomes",
    detail: "Two legs can win the same state, double-counting the apparent return.",
  },
  BOTH_LOSS_STATE: {
    headline: "Both-legs-loss state exists",
    detail: "There is a settlement state in which every leg loses.",
  },
  NEGATIVE_GUARANTEED_PROFIT: {
    headline: "No positive guaranteed return",
    detail: "The implied margin is insufficient: some settlement state returns less than staked.",
  },
  STALE_ODDS: {
    headline: "Prices aged past the freshness horizon",
    detail:
      "The quoted prices are older than the freshness policy allows, so they may no longer be actionable.",
  },
  INVALID_ODDS: {
    headline: "Invalid odds",
    detail: "An odds value is missing, non-finite, or below the minimum allowed.",
  },
  INVALID_ODDS_PAYLOAD: {
    headline: "Invalid odds payload",
    detail: "The provider response could not be parsed into valid prices.",
  },
  INVALID_MARKET: {
    headline: "Invalid market",
    detail: "A market could not be normalized to a supported structure.",
  },
  UNSUPPORTED_MARKET: {
    headline: "Unsupported market",
    detail: "A market family has no implemented settlement/state model, so it is never assumed.",
  },
  NO_STATE_MODEL: {
    headline: "No state model",
    detail:
      "The selections cannot be reduced to a settlement matrix with the current engine versions.",
  },
  INCOMPLETE_COVERAGE: {
    headline: "Incomplete coverage",
    detail: "The coverage analysis could not certify that every state is covered.",
  },
  STAKE_LIMIT: {
    headline: "Stake limit reached",
    detail: "The optimizer could not place the required stakes (limits or same-bookmaker policy).",
  },
  ROUNDING_DESTROYS_PROFIT: {
    headline: "Rounding destroys profit",
    detail: "Stakes rounded to the stake step no longer produce a positive minimum return.",
  },
  OPTIMIZATION_FAILED: {
    headline: "Optimization failed",
    detail: "The stake optimizer did not converge on a feasible positive plan.",
  },
  PROVIDER_ERROR: {
    headline: "Provider error",
    detail: "A provider returned an error during validation.",
  },
  PROVIDER_UNAVAILABLE: {
    headline: "Provider unavailable",
    detail: "A source was down or unreachable, so its prices could not be relied on.",
  },
  SETTLEMENT_CONFIDENCE_LOW: {
    headline: "Settlement confidence below floor",
    detail: "The settlement rule confidence is attested but below the verification floor.",
  },
  CROSS_SOURCE_TIMESTAMP_SPREAD: {
    headline: "Prices not contemporaneous",
    detail:
      "The legs' source timestamps are too far apart, so they were not necessarily available at once.",
  },
  PRICE_CHANGED_ON_RECHECK: {
    headline: "Price moved on final recheck",
    detail:
      "The recheck found a price that changed beyond tolerance, invalidating the locked-in plan.",
  },
  INSUFFICIENT_PROVENANCE: {
    headline: "Insufficient provenance",
    detail:
      "Legs lack attested stamps (source timestamp / event confidence / settlement confidence / source status), so nothing is promoted without proof (Rule 5).",
  },
};

export function rejectionEvidence(opp: OpportunityView): ExplanationSection {
  const copy = opp.rejectionReason !== null ? REJECTION_COPY[opp.rejectionReason] : undefined;
  return {
    title: "Why this is not an opportunity",
    tone: "negative",
    summary:
      copy?.headline ??
      (opp.status === OpportunityStatus.INVALIDATED
        ? "Invalidated after verification"
        : "Rejected before it could be shown"),
    points: [
      ...(copy ? [copy.detail] : []),
      ...(opp.rejectionReason !== null
        ? [`Reason code: ${opp.rejectionReason}`]
        : [`Lifecycle status: ${opp.status}`]),
    ],
  };
}

export function freshnessEvidence(opp: OpportunityView, now: number): ExplanationSection {
  const anchor = opp.validatedAt ?? opp.detectedAt;
  const expiresAt = opp.expiresAt ? Date.parse(opp.expiresAt) : Number.NaN;
  const expired = Number.isFinite(expiresAt) && now > expiresAt;
  const points = [
    opp.validatedAt !== null
      ? `Detected ${formatAge(opp.detectedAt, now)}, validated ${formatAge(
          opp.validatedAt,
          now
        )} — every price was within its freshness horizon at validation time.`
      : `Detected ${formatAge(opp.detectedAt, now)}, not validated.`,
  ];
  if (opp.expiresAt !== null) {
    points.push(
      expired
        ? `The recheck window closed at ${opp.expiresAt}; prices are no longer guaranteed fresh.`
        : `Still inside the recheck window (closes ${opp.expiresAt}).`
    );
  }
  return {
    title: "Freshness",
    tone: expired ? "negative" : "neutral",
    summary: `Age relative to now: ${formatAge(anchor, now)}.`,
    points,
  };
}

export function opportunityEvidence(opp: OpportunityView, now: number): ExplanationSection[] {
  const sections: ExplanationSection[] = [];
  if (isArbStatus(opp.status)) {
    sections.push(arbitrageEvidence(opp));
    sections.push(structureEvidence(opp.marketStructure));
    sections.push(settlementEvidence(opp));
  } else if (
    opp.status === OpportunityStatus.INVALIDATED ||
    opp.status === OpportunityStatus.REJECTED
  ) {
    sections.push(rejectionEvidence(opp));
  }
  sections.push(freshnessEvidence(opp, now));
  return sections;
}
