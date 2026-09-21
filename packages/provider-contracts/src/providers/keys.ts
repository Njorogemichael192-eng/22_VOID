import { MarketFamily, MarketType, Participant, Period } from "@22void/domain";

/**
 * Canonical market-key registry for the supported providers (Phase 3).
 *
 * Maps provider-native market keys to the canonical market taxonomy defined in
 * @22void/domain so adapters can build ProviderEnvelope records without
 * embedding provider names in the domain. Keys that were verified but have no
 * canonical settlement semantics yet are intentionally NOT registered (e.g.
 * soccer "spreads" handicaps and "draw_no_bet" remain unmapped until their
 * settlement rules are verified — Rule 3: unknown settlement means no arb).
 */

export interface MarketKeySpec {
  family: MarketFamily;
  marketType: MarketType;
  period: Period;
  /** When true the wager line comes from the outcome point or label suffix. */
  usesPoint: boolean;
  /**
   * When "team_totals" the market is split into per-participant, per-line
   * canonical markets (home/away team totals) on the wire keys
   * team_totals_home / team_totals_away.
   */
  teamSplit?: "team_totals";
  /** Participant to default to for team split when labels carry no team. */
  teamFallback?: Participant;
}

function teamTotalsSpec(teamFallback: Participant): MarketKeySpec {
  return {
    family: MarketFamily.TEAM_TOTAL,
    marketType: MarketType.STANDARD,
    period: Period.FULL_MATCH,
    usesPoint: true,
    teamSplit: "team_totals",
    teamFallback,
  };
}

export const ODDS_API_MARKET_KEYS: Readonly<Record<string, MarketKeySpec>> = {
  h2h: {
    family: MarketFamily.MATCH_RESULT,
    marketType: MarketType.ONE_X_TWO,
    period: Period.FULL_MATCH,
    usesPoint: false,
  },
  h2h_3_way: {
    family: MarketFamily.MATCH_RESULT,
    marketType: MarketType.ONE_X_TWO,
    period: Period.FULL_MATCH,
    usesPoint: false,
  },
  totals: {
    family: MarketFamily.MATCH_TOTAL,
    marketType: MarketType.STANDARD,
    period: Period.FULL_MATCH,
    usesPoint: true,
  },
  btts: {
    family: MarketFamily.BTTS,
    marketType: MarketType.BTTS,
    period: Period.FULL_MATCH,
    usesPoint: false,
  },
  double_chance: {
    family: MarketFamily.DOUBLE_CHANCE,
    marketType: MarketType.DOUBLE_CHANCE,
    period: Period.FULL_MATCH,
    usesPoint: false,
  },
  correct_score: {
    family: MarketFamily.EXACT_SCORE,
    marketType: MarketType.EXACT_SCORE,
    period: Period.FULL_MATCH,
    usesPoint: false,
  },
  team_totals_home: teamTotalsSpec(Participant.HOME),
  team_totals_away: teamTotalsSpec(Participant.AWAY),
  h2h_1st_half: {
    family: MarketFamily.MATCH_RESULT,
    marketType: MarketType.ONE_X_TWO,
    period: Period.FIRST_HALF,
    usesPoint: false,
  },
  totals_1st_half: {
    family: MarketFamily.MATCH_TOTAL,
    marketType: MarketType.STANDARD,
    period: Period.FIRST_HALF,
    usesPoint: true,
  },
  alternate_totals_corners: {
    family: MarketFamily.CORNERS,
    marketType: MarketType.STANDARD,
    period: Period.FULL_MATCH,
    usesPoint: true,
  },
  alternate_totals_cards: {
    family: MarketFamily.CARDS,
    marketType: MarketType.STANDARD,
    period: Period.FULL_MATCH,
    usesPoint: true,
  },
};

export const PARLAY_API_MARKET_KEYS: Readonly<Record<string, MarketKeySpec>> = {
  h2h_3_way: {
    family: MarketFamily.MATCH_RESULT,
    marketType: MarketType.ONE_X_TWO,
    period: Period.FULL_MATCH,
    usesPoint: false,
  },
  totals: {
    family: MarketFamily.MATCH_TOTAL,
    marketType: MarketType.STANDARD,
    period: Period.FULL_MATCH,
    usesPoint: true,
  },
  btts: {
    family: MarketFamily.BTTS,
    marketType: MarketType.BTTS,
    period: Period.FULL_MATCH,
    usesPoint: false,
  },
  double_chance: {
    family: MarketFamily.DOUBLE_CHANCE,
    marketType: MarketType.DOUBLE_CHANCE,
    period: Period.FULL_MATCH,
    usesPoint: false,
  },
  correct_score: {
    family: MarketFamily.EXACT_SCORE,
    marketType: MarketType.EXACT_SCORE,
    period: Period.FULL_MATCH,
    usesPoint: false,
  },
  team_totals_home: teamTotalsSpec(Participant.HOME),
  team_totals_away: teamTotalsSpec(Participant.AWAY),
  h2h_1st_half: {
    family: MarketFamily.MATCH_RESULT,
    marketType: MarketType.ONE_X_TWO,
    period: Period.FIRST_HALF,
    usesPoint: false,
  },
  totals_1st_half: {
    family: MarketFamily.MATCH_TOTAL,
    marketType: MarketType.STANDARD,
    period: Period.FIRST_HALF,
    usesPoint: true,
  },
};

export function getMarketKeySpec(
  registry: Readonly<Record<string, MarketKeySpec>>,
  key: string
): MarketKeySpec | undefined {
  return registry[key];
}

export { MarketFamily, MarketType, Period };
