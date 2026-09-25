import type {
  MarketFamily,
  OpportunityStatus,
  Period,
  RejectionReason,
} from "@22void/domain";

/**
 * Golden regression candidate cases (Phase 17 regression fixtures).
 *
 * Every row in the BUILD_AGENT_PROMPT Phase 17 fixture list is covered here as
 * a structural leg set plus the lifecycle the engine MUST produce. Plain data
 * only — no engine imports — so the suites own the mapping to engine types.
 *
 * The `reciprocalTrap` flag marks cases whose `sum(1/odds) < 1` yet MUST NOT be
 * classified as an arbitrage: the state/payoff model is the authority, never
 * the reciprocal-sum shortcut (spec §2, §45).
 */

export type RegressionSourceStatus = "OK" | "DEGRADED" | "DOWN" | "UNKNOWN";

export interface RegressionLeg {
  id: string;
  eventId: string;
  family: MarketFamily;
  marketType: string;
  period: Period;
  participant?: "HOME" | "AWAY";
  line?: string;
  outcome: string;
  odds: number;
  bookmaker: string;
  /** Epoch ms the price was observed (freshness model §38). */
  observedAt?: number;
  /** ISO supplier update time (§38 sourceUpdatedAt). */
  sourceUpdatedAt?: string;
  eventConfidence?: number;
  settlementConfidence?: number;
  sourceStatus?: RegressionSourceStatus;
}

export interface RegressionExpectation {
  /** Scan lifecycle the pipeline MUST produce. */
  scan: "ARB" | "NO_ARB" | "REJECTED" | "PRUNED";
  /** Structure classification the generator must produce on this leg set. */
  structure?: string;
  /** Rejection reasons that must appear when the scan is REJECTED/PRUNED. */
  reasons?: RejectionReason[];
  /** Optimizer must establish a positive guaranteed profit. */
  arb?: boolean;
  /** validateCandidate lifecycle given full provenance and an exact recheck. */
  validated?: OpportunityStatus;
}

export interface RegressionCase {
  id: string;
  note: string;
  /** True when sum(1/odds) < 1 but the case must still be REJECTED/PRUNED. */
  reciprocalTrap?: boolean;
  legs: RegressionLeg[];
  expected: RegressionExpectation;
}

const EVENT_A = "reg-evt-a";
const EVENT_B = "reg-evt-b";

/** Fresh-price instant shared by the golden arb cases. */
const FRESH = "2026-09-20T12:00:00.000Z";
const FRESH_MS = Date.parse(FRESH);

function freshProvenance(
  id: string,
  eventId: string,
  bookmaker: string,
  sourceUpdatedAt = FRESH,
  observedAt = FRESH_MS
): Omit<RegressionLeg, "family" | "marketType" | "period" | "participant" | "line" | "outcome" | "odds"> {
  return {
    id,
    eventId,
    bookmaker,
    observedAt,
    sourceUpdatedAt,
    eventConfidence: 0.95,
    settlementConfidence: 0.95,
    sourceStatus: "OK",
  };
}

export const regressionCases: RegressionCase[] = [
  {
    id: "CASE_01_STANDARD_COMPLEMENT",
    note: "Whole-line standard complement (Over/Under 2.5) — genuine arb.",
    legs: [
      {
        ...freshProvenance("a-over-25", EVENT_A, "book-a"),
        family: "MATCH_TOTAL",
        marketType: "STANDARD",
        period: "FULL_MATCH",
        line: "2.5",
        outcome: "OVER",
        odds: 2.1,
      },
      {
        ...freshProvenance("a-under-25", EVENT_A, "book-b"),
        family: "MATCH_TOTAL",
        marketType: "STANDARD",
        period: "FULL_MATCH",
        line: "2.5",
        outcome: "UNDER",
        odds: 2.0,
      },
    ],
    expected: {
      scan: "ARB",
      structure: "SAME_MARKET_COMPLEMENT",
      arb: true,
      validated: "VERIFIED_ARB",
    },
  },
  {
    id: "CASE_02_1X2_THREE_WAY",
    note: "Three-leg 1X2 result partition — genuine arb.",
    legs: [
      {
        ...freshProvenance("b-home", EVENT_A, "book-a"),
        family: "MATCH_RESULT",
        marketType: "ONE_X_TWO",
        period: "FULL_MATCH",
        outcome: "HOME",
        odds: 3.2,
      },
      {
        ...freshProvenance("b-draw", EVENT_A, "book-b"),
        family: "MATCH_RESULT",
        marketType: "ONE_X_TWO",
        period: "FULL_MATCH",
        outcome: "DRAW",
        odds: 3.3,
      },
      {
        ...freshProvenance("b-away", EVENT_A, "book-c"),
        family: "MATCH_RESULT",
        marketType: "ONE_X_TWO",
        period: "FULL_MATCH",
        outcome: "AWAY",
        odds: 2.9,
      },
    ],
    expected: {
      scan: "ARB",
      structure: "PARTITION",
      arb: true,
      validated: "VERIFIED_ARB",
    },
  },
  {
    id: "CASE_03_DOUBLE_CHANCE_PLUS_1X2",
    note: "Mixed DC + 1X2 partition (1X covers home win and draw, AWAY covers the rest) — genuine arb.",
    legs: [
      {
        ...freshProvenance("c-1x", EVENT_A, "book-a"),
        family: "DOUBLE_CHANCE",
        marketType: "DOUBLE_CHANCE",
        period: "FULL_MATCH",
        outcome: "HOME_OR_DRAW",
        odds: 1.95,
      },
      {
        ...freshProvenance("c-away", EVENT_A, "book-b"),
        family: "MATCH_RESULT",
        marketType: "ONE_X_TWO",
        period: "FULL_MATCH",
        outcome: "AWAY",
        odds: 2.1,
      },
    ],
    expected: {
      scan: "ARB",
      structure: "GENERIC",
      arb: true,
      validated: "VERIFIED_ARB",
    },
  },
  {
    id: "CASE_04_OVERLAPPING_TOTALS_FALSE_ARB",
    note: "Overlapping totals trap: Over 10.5 vs Under 13.5 both win when total is 11..13 → NON_EXCLUSIVE. reciprocalTrap.",
    reciprocalTrap: true,
    legs: [
      {
        ...freshProvenance("d-over-105", EVENT_A, "book-a"),
        family: "MATCH_TOTAL",
        marketType: "STANDARD",
        period: "FULL_MATCH",
        line: "10.5",
        outcome: "OVER",
        odds: 5.0,
      },
      {
        ...freshProvenance("d-under-135", EVENT_A, "book-b"),
        family: "MATCH_TOTAL",
        marketType: "STANDARD",
        period: "FULL_MATCH",
        line: "13.5",
        outcome: "UNDER",
        odds: 9.0,
      },
    ],
    expected: {
      scan: "REJECTED",
      structure: "COMPLEMENTARY_TOTALS",
      reasons: ["NON_EXCLUSIVE"],
    },
  },
  {
    id: "CASE_05_TEAM_TOTAL_MATCH_TOTAL_PARTITION",
    note: "The match-total under-1.5 plus BOTH team-total over-1.5: every state is covered except 1-1 (home and away < 2 while total > 1.5), so all three legs lose together → BOTH_LOSS_STATE. reciprocalTrap.",
    reciprocalTrap: true,
    legs: [
      {
        ...freshProvenance("e-under-15", EVENT_A, "book-a"),
        family: "MATCH_TOTAL",
        marketType: "STANDARD",
        period: "FULL_MATCH",
        line: "1.5",
        outcome: "UNDER",
        odds: 4.5,
      },
      {
        ...freshProvenance("e-home-over-15", EVENT_A, "book-b"),
        family: "TEAM_TOTAL",
        marketType: "STANDARD",
        period: "FULL_MATCH",
        participant: "HOME",
        line: "1.5",
        outcome: "OVER",
        odds: 2.7,
      },
      {
        ...freshProvenance("e-away-over-15", EVENT_A, "book-c"),
        family: "TEAM_TOTAL",
        marketType: "STANDARD",
        period: "FULL_MATCH",
        participant: "AWAY",
        line: "1.5",
        outcome: "OVER",
        odds: 2.7,
      },
    ],
    expected: {
      scan: "REJECTED",
      structure: "TEAM_TOTAL_MATCH_TOTAL",
      reasons: ["BOTH_LOSS_STATE"],
    },
  },
  {
    id: "CASE_06_ASIAN_PUSH_GAP_WHOLE",
    note: "Whole Asian pair Over 2.0 + Under 2.0: on exactly 2 goals both PUSH → uncovered state → NON_EXHAUSTIVE. reciprocalTrap.",
    reciprocalTrap: true,
    legs: [
      {
        ...freshProvenance("f-over-20", EVENT_A, "book-a"),
        family: "ASIAN_TOTAL",
        marketType: "ASIAN",
        period: "FULL_MATCH",
        line: "2.0",
        outcome: "OVER",
        odds: 3.0,
      },
      {
        ...freshProvenance("f-under-20", EVENT_A, "book-b"),
        family: "ASIAN_TOTAL",
        marketType: "ASIAN",
        period: "FULL_MATCH",
        line: "2.0",
        outcome: "UNDER",
        odds: 3.0,
      },
    ],
    expected: {
      scan: "REJECTED",
      structure: "ASIAN_LINE",
      reasons: ["NON_EXHAUSTIVE"],
    },
  },
  {
    id: "CASE_07_HANDICAP_PUSH_GAP",
    note: "Home +1.0 vs Away −1.0: when the away team wins by exactly one both PUSH → uncovered state → NON_EXHAUSTIVE. reciprocalTrap.",
    reciprocalTrap: true,
    legs: [
      {
        ...freshProvenance("g-home-plus-1", EVENT_A, "book-a"),
        family: "ASIAN_HANDICAP",
        marketType: "HANDICAP",
        period: "FULL_MATCH",
        participant: "HOME",
        line: "1",
        outcome: "HOME",
        odds: 2.2,
      },
      {
        ...freshProvenance("g-away-minus-1", EVENT_A, "book-b"),
        family: "ASIAN_HANDICAP",
        marketType: "HANDICAP",
        period: "FULL_MATCH",
        participant: "AWAY",
        line: "-1",
        outcome: "AWAY",
        odds: 1.9,
      },
    ],
    expected: {
      scan: "REJECTED",
      structure: "PROTECTED_HANDICAP",
      reasons: ["NON_EXHAUSTIVE"],
    },
  },
  {
    id: "CASE_08_BOTH_LOSS_STATE",
    note: "Home Over 2.5 and Away Over 2.5 both lose on low-scoring draws (0-0, 1-1) → BOTH_LOSS_STATE. reciprocalTrap.",
    reciprocalTrap: true,
    legs: [
      {
        ...freshProvenance("h-home-over-25", EVENT_A, "book-a"),
        family: "TEAM_TOTAL",
        marketType: "STANDARD",
        period: "FULL_MATCH",
        participant: "HOME",
        line: "2.5",
        outcome: "OVER",
        odds: 4.0,
      },
      {
        ...freshProvenance("h-away-over-25", EVENT_A, "book-b"),
        family: "TEAM_TOTAL",
        marketType: "STANDARD",
        period: "FULL_MATCH",
        participant: "AWAY",
        line: "2.5",
        outcome: "OVER",
        odds: 4.0,
      },
    ],
    expected: {
      scan: "REJECTED",
      structure: "GENERIC",
      reasons: ["BOTH_LOSS_STATE"],
    },
  },
  {
    id: "CASE_09_UNCOVERED_STATES",
    note: "Under 1.5 + Over 6.5: on totals 2..6 both legs lose together → BOTH_LOSS_STATE. reciprocalTrap.",
    reciprocalTrap: true,
    legs: [
      {
        ...freshProvenance("i-under-15", EVENT_A, "book-a"),
        family: "MATCH_TOTAL",
        marketType: "STANDARD",
        period: "FULL_MATCH",
        line: "1.5",
        outcome: "UNDER",
        odds: 2.1,
      },
      {
        ...freshProvenance("i-over-65", EVENT_A, "book-b"),
        family: "MATCH_TOTAL",
        marketType: "STANDARD",
        period: "FULL_MATCH",
        line: "6.5",
        outcome: "OVER",
        odds: 5.0,
      },
    ],
    expected: {
      scan: "REJECTED",
      structure: "COMPLEMENTARY_TOTALS",
      reasons: ["BOTH_LOSS_STATE"],
    },
  },
  {
    id: "CASE_10_THREE_LEG_RESULT_PARTITION",
    note: "Three-leg partition over results: HOME, DRAW, HOME_OR_AWAY — genuine arb.",
    legs: [
      {
        ...freshProvenance("j-home", EVENT_A, "book-a"),
        family: "MATCH_RESULT",
        marketType: "ONE_X_TWO",
        period: "FULL_MATCH",
        outcome: "HOME",
        odds: 3.6,
      },
      {
        ...freshProvenance("j-draw", EVENT_A, "book-b"),
        family: "MATCH_RESULT",
        marketType: "ONE_X_TWO",
        period: "FULL_MATCH",
        outcome: "DRAW",
        odds: 4.4,
      },
      {
        ...freshProvenance("j-12", EVENT_A, "book-c"),
        family: "DOUBLE_CHANCE",
        marketType: "DOUBLE_CHANCE",
        period: "FULL_MATCH",
        outcome: "HOME_OR_AWAY",
        odds: 2.2,
      },
    ],
    expected: {
      scan: "ARB",
      structure: "MULTI_LEG_PARTITION",
      arb: true,
      validated: "VERIFIED_ARB",
    },
  },
  {
    id: "CASE_11_STALE_ODDS",
    note: "Structurally identical to CASE_01 but the under leg's price is hours old → scan is ARB, validation is STALE with a STALE_ODDS rejection.",
    legs: [
      {
        ...freshProvenance("k-over-25", EVENT_A, "book-a"),
        family: "MATCH_TOTAL",
        marketType: "STANDARD",
        period: "FULL_MATCH",
        line: "2.5",
        outcome: "OVER",
        odds: 2.1,
      },
      {
        ...freshProvenance("k-under-25", EVENT_A, "book-b", "2026-09-20T10:00:00.000Z", Date.parse("2026-09-20T10:00:00.000Z")),
        family: "MATCH_TOTAL",
        marketType: "STANDARD",
        period: "FULL_MATCH",
        line: "2.5",
        outcome: "UNDER",
        odds: 2.0,
      },
    ],
    expected: {
      scan: "ARB",
      structure: "SAME_MARKET_COMPLEMENT",
      arb: true,
      validated: "STALE",
    },
  },
  {
    id: "CASE_12_MISMATCHED_EVENTS",
    note: "Two equivalent markets on different canonical events: the generator never merges events (no scan is produced), and a hand-forged cross-event candidate is rejected with EVENT_MISMATCH. Structure classification alone still reports SAME_MARKET_COMPLEMENT.",
    legs: [
      {
        ...freshProvenance("l-a-over-25", EVENT_A, "book-a"),
        family: "MATCH_TOTAL",
        marketType: "STANDARD",
        period: "FULL_MATCH",
        line: "2.5",
        outcome: "OVER",
        odds: 2.0,
      },
      {
        ...freshProvenance("l-b-under-25", EVENT_B, "book-b"),
        family: "MATCH_TOTAL",
        marketType: "STANDARD",
        period: "FULL_MATCH",
        line: "2.5",
        outcome: "UNDER",
        odds: 2.0,
      },
    ],
    expected: {
      scan: "PRUNED",
      structure: "SAME_MARKET_COMPLEMENT",
      reasons: ["EVENT_MISMATCH"],
    },
  },
  {
    id: "CASE_13_NO_ARB_OVERROUND",
    note: "Overround 1X2 partition (sum(1/odds) > 1): the partition still covers every state, so coverage is COVERED yet the optimizer establishes no profit → NO_ARB.",
    legs: [
      {
        ...freshProvenance("m-home", EVENT_A, "book-a"),
        family: "MATCH_RESULT",
        marketType: "ONE_X_TWO",
        period: "FULL_MATCH",
        outcome: "HOME",
        odds: 1.95,
      },
      {
        ...freshProvenance("m-draw", EVENT_A, "book-b"),
        family: "MATCH_RESULT",
        marketType: "ONE_X_TWO",
        period: "FULL_MATCH",
        outcome: "DRAW",
        odds: 3.0,
      },
      {
        ...freshProvenance("m-away", EVENT_A, "book-c"),
        family: "MATCH_RESULT",
        marketType: "ONE_X_TWO",
        period: "FULL_MATCH",
        outcome: "AWAY",
        odds: 4.0,
      },
    ],
    expected: {
      scan: "NO_ARB",
      structure: "PARTITION",
      arb: false,
    },
  },
];