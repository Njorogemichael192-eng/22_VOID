import type { MarketFamily, Participant, Period, SettlementResult } from "@22void/domain";

/**
 * Golden settlement tables (spec §9–§16, §68) — Phase 17 regression fixtures.
 *
 * Each row pins one canonical selection + match state to its expected settlement
 * result, per-component breakdown and decimal return multiplier (spec §10).
 * Rows cover standard totals, Asian quarter-line splits, handicap push cases,
 * 1X2 / double chance / BTTS and the VOID path. Tests feed these through
 * `@22void/settlement` verbatim.
 */

export interface GoldenSelectionInput {
  family: MarketFamily;
  marketType: string;
  period: Period;
  participant?: Participant;
  line?: string;
  outcome: string;
  odds: number;
}

export interface GoldenScoreInput {
  home: number;
  away: number;
}

export interface SettlementGoldenRow {
  id: string;
  label: string;
  selection: GoldenSelectionInput;
  scores: {
    fullTime: GoldenScoreInput;
    firstHalf?: GoldenScoreInput;
  };
  /** Defaults to FINISHED; POSTPONED exercises the VOID path. */
  status?: "FINISHED" | "POSTPONED";
  expected: {
    result: SettlementResult;
    components?: string[];
    /** Stake multiplier implied by the result at these odds (§10). */
    returnMultiplier: number;
    /** Return on a KSh 100 stake. */
    payoutPer100: number;
  };
}

export const settlementGoldenRows: SettlementGoldenRow[] = [
  {
    id: "settle-mt-over-25-win",
    label: "MATCH_TOTAL Over 2.5 wins at total 3",
    selection: {
      family: "MATCH_TOTAL",
      marketType: "STANDARD",
      period: "FULL_MATCH",
      line: "2.5",
      outcome: "OVER",
      odds: 2.1,
    },
    scores: { fullTime: { home: 3, away: 0 } },
    expected: { result: "FULL_WIN", returnMultiplier: 2.1, payoutPer100: 210 },
  },
  {
    id: "settle-mt-under-25-win",
    label: "MATCH_TOTAL Under 2.5 wins at total 2",
    selection: {
      family: "MATCH_TOTAL",
      marketType: "STANDARD",
      period: "FULL_MATCH",
      line: "2.5",
      outcome: "UNDER",
      odds: 2.0,
    },
    scores: { fullTime: { home: 2, away: 0 } },
    expected: { result: "FULL_WIN", returnMultiplier: 2.0, payoutPer100: 200 },
  },
  {
    id: "settle-mt-over-25-loss",
    label: "MATCH_TOTAL Over 2.5 loses at total 2",
    selection: {
      family: "MATCH_TOTAL",
      marketType: "STANDARD",
      period: "FULL_MATCH",
      line: "2.5",
      outcome: "OVER",
      odds: 2.1,
    },
    scores: { fullTime: { home: 2, away: 0 } },
    expected: { result: "FULL_LOSS", returnMultiplier: 0, payoutPer100: 0 },
  },
  {
    id: "settle-asian-total-200-push",
    label: "ASIAN_TOTAL Over 2.0 pushes at total 2",
    selection: {
      family: "ASIAN_TOTAL",
      marketType: "ASIAN",
      period: "FULL_MATCH",
      line: "2.0",
      outcome: "OVER",
      odds: 2.6,
    },
    scores: { fullTime: { home: 1, away: 1 } },
    expected: { result: "PUSH", returnMultiplier: 1, payoutPer100: 100 },
  },
  {
    id: "settle-asian-total-under-225-half-win",
    label: "ASIAN_TOTAL Under 2.25 at total 2 → [PUSH, WIN] → HALF_WIN",
    selection: {
      family: "ASIAN_TOTAL",
      marketType: "ASIAN",
      period: "FULL_MATCH",
      line: "2.25",
      outcome: "UNDER",
      odds: 2.0,
    },
    scores: { fullTime: { home: 2, away: 0 } },
    expected: {
      result: "HALF_WIN",
      components: ["PUSH", "WIN"],
      returnMultiplier: 1.5,
      payoutPer100: 150,
    },
  },
  {
    id: "settle-asian-total-over-225-half-loss",
    label: "ASIAN_TOTAL Over 2.25 at total 2 → [PUSH, LOSS] → HALF_LOSS",
    selection: {
      family: "ASIAN_TOTAL",
      marketType: "ASIAN",
      period: "FULL_MATCH",
      line: "2.25",
      outcome: "OVER",
      odds: 2.4,
    },
    scores: { fullTime: { home: 1, away: 1 } },
    expected: {
      result: "HALF_LOSS",
      components: ["PUSH", "LOSS"],
      returnMultiplier: 0.5,
      payoutPer100: 50,
    },
  },
  {
    id: "settle-asian-total-over-075-half-win",
    label: "ASIAN_TOTAL Over 0.75 at total 1 → [WIN, PUSH] → HALF_WIN",
    selection: {
      family: "ASIAN_TOTAL",
      marketType: "ASIAN",
      period: "FULL_MATCH",
      line: "0.75",
      outcome: "OVER",
      odds: 1.8,
    },
    scores: { fullTime: { home: 1, away: 0 } },
    expected: {
      result: "HALF_WIN",
      components: ["WIN", "PUSH"],
      returnMultiplier: 1.4,
      payoutPer100: 140,
    },
  },
  {
    id: "settle-team-total-home-over-15-win",
    label: "TEAM_TOTAL HOME Over 1.5 wins when home scores 2",
    selection: {
      family: "TEAM_TOTAL",
      marketType: "STANDARD",
      period: "FULL_MATCH",
      participant: "HOME",
      line: "1.5",
      outcome: "OVER",
      odds: 2.15,
    },
    scores: { fullTime: { home: 2, away: 1 } },
    expected: { result: "FULL_WIN", returnMultiplier: 2.15, payoutPer100: 215 },
  },
  {
    id: "settle-team-total-away-under-05-win",
    label: "TEAM_TOTAL AWAY Under 0.5 wins when away scores 0",
    selection: {
      family: "TEAM_TOTAL",
      marketType: "STANDARD",
      period: "FULL_MATCH",
      participant: "AWAY",
      line: "0.5",
      outcome: "UNDER",
      odds: 1.6,
    },
    scores: { fullTime: { home: 2, away: 0 } },
    expected: { result: "FULL_WIN", returnMultiplier: 1.6, payoutPer100: 160 },
  },
  {
    id: "settle-handicap-home-minus-1-win",
    label: "ASIAN_HANDICAP HOME −1.0 wins when home wins by 2",
    selection: {
      family: "ASIAN_HANDICAP",
      marketType: "HANDICAP",
      period: "FULL_MATCH",
      participant: "HOME",
      line: "-1",
      outcome: "HOME",
      odds: 1.9,
    },
    scores: { fullTime: { home: 2, away: 0 } },
    expected: { result: "FULL_WIN", returnMultiplier: 1.9, payoutPer100: 190 },
  },
  {
    id: "settle-handicap-home-minus-1-push",
    label: "ASIAN_HANDICAP HOME −1.0 pushes when home wins by exactly 1",
    selection: {
      family: "ASIAN_HANDICAP",
      marketType: "HANDICAP",
      period: "FULL_MATCH",
      participant: "HOME",
      line: "-1",
      outcome: "HOME",
      odds: 1.9,
    },
    scores: { fullTime: { home: 1, away: 0 } },
    expected: { result: "PUSH", returnMultiplier: 1, payoutPer100: 100 },
  },
  {
    id: "settle-handicap-home-minus-1-loss",
    label: "ASIAN_HANDICAP HOME −1.0 loses when the match is drawn",
    selection: {
      family: "ASIAN_HANDICAP",
      marketType: "HANDICAP",
      period: "FULL_MATCH",
      participant: "HOME",
      line: "-1",
      outcome: "HOME",
      odds: 1.9,
    },
    scores: { fullTime: { home: 1, away: 1 } },
    expected: { result: "FULL_LOSS", returnMultiplier: 0, payoutPer100: 0 },
  },
  {
    id: "settle-handicap-home-plus-075-win",
    label: "ASIAN_HANDICAP HOME +0.75 wins when home wins by 1 → [WIN, WIN]",
    selection: {
      family: "ASIAN_HANDICAP",
      marketType: "HANDICAP",
      period: "FULL_MATCH",
      participant: "HOME",
      line: "0.75",
      outcome: "HOME",
      odds: 1.85,
    },
    scores: { fullTime: { home: 1, away: 0 } },
    expected: {
      result: "FULL_WIN",
      components: ["WIN", "WIN"],
      returnMultiplier: 1.85,
      payoutPer100: 185,
    },
  },
  {
    id: "settle-result-home-win",
    label: "MATCH_RESULT HOME wins when home wins",
    selection: {
      family: "MATCH_RESULT",
      marketType: "ONE_X_TWO",
      period: "FULL_MATCH",
      outcome: "HOME",
      odds: 2.6,
    },
    scores: { fullTime: { home: 2, away: 0 } },
    expected: { result: "FULL_WIN", returnMultiplier: 2.6, payoutPer100: 260 },
  },
  {
    id: "settle-result-home-loss",
    label: "MATCH_RESULT HOME loses when the match is drawn",
    selection: {
      family: "MATCH_RESULT",
      marketType: "ONE_X_TWO",
      period: "FULL_MATCH",
      outcome: "HOME",
      odds: 2.6,
    },
    scores: { fullTime: { home: 1, away: 1 } },
    expected: { result: "FULL_LOSS", returnMultiplier: 0, payoutPer100: 0 },
  },
  {
    id: "settle-dc-home-or-draw-win",
    label: "DOUBLE_CHANCE HOME_OR_DRAW wins on a draw",
    selection: {
      family: "DOUBLE_CHANCE",
      marketType: "DOUBLE_CHANCE",
      period: "FULL_MATCH",
      outcome: "HOME_OR_DRAW",
      odds: 1.32,
    },
    scores: { fullTime: { home: 1, away: 1 } },
    expected: { result: "FULL_WIN", returnMultiplier: 1.32, payoutPer100: 132 },
  },
  {
    id: "settle-btts-yes-win",
    label: "BTTS Yes wins when both teams score",
    selection: {
      family: "BTTS",
      marketType: "BTTS",
      period: "FULL_MATCH",
      outcome: "BTTS_YES",
      odds: 1.62,
    },
    scores: { fullTime: { home: 1, away: 1 } },
    expected: { result: "FULL_WIN", returnMultiplier: 1.62, payoutPer100: 162 },
  },
  {
    id: "settle-btts-no-win",
    label: "BTTS No wins when neither team scores",
    selection: {
      family: "BTTS",
      marketType: "BTTS",
      period: "FULL_MATCH",
      outcome: "BTTS_NO",
      odds: 2.25,
    },
    scores: { fullTime: { home: 0, away: 0 } },
    expected: { result: "FULL_WIN", returnMultiplier: 2.25, payoutPer100: 225 },
  },
  {
    id: "settle-void-postponed",
    label: "Any selection on a postponed event is VOID (stake returned)",
    selection: {
      family: "MATCH_TOTAL",
      marketType: "STANDARD",
      period: "FULL_MATCH",
      line: "2.5",
      outcome: "OVER",
      odds: 2.0,
    },
    status: "POSTPONED",
    scores: { fullTime: { home: 0, away: 0 } },
    expected: { result: "VOID", returnMultiplier: 1, payoutPer100: 100 },
  },
  {
    id: "settle-second-half-derived",
    label: "SECOND_HALF total derived from fullTime − firstHalf",
    selection: {
      family: "MATCH_TOTAL",
      marketType: "STANDARD",
      period: "SECOND_HALF",
      line: "1.5",
      outcome: "OVER",
      odds: 2.3,
    },
    scores: { fullTime: { home: 2, away: 1 }, firstHalf: { home: 1, away: 1 } },
    expected: { result: "FULL_LOSS", returnMultiplier: 0, payoutPer100: 0 },
  },
];