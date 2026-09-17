/**
 * @22void/outcome-engine
 *
 * Football outcome/state engine (BUILD_AGENT_PROMPT Phase 7).
 * Represents score as (H,A) with T=H+A and generates relevant state classes
 * by partitioning the infinite score space at settlement boundaries
 * (ARBITRAGE_ENGINE_SPEC §16–20).
 *
 * Status: Phase 0 skeleton. Implemented in Phase 7.
 */

/** Football full-match score state: (homeGoals, awayGoals). */
export interface FootballScore {
  homeGoals: number;
  awayGoals: number;
}

/** Returns the match total for a football score. */
export function matchTotal(score: FootballScore): number {
  return score.homeGoals + score.awayGoals;
}

/** Returns the goal margin (home minus away) used by handicaps. */
export function goalMargin(score: FootballScore): number {
  return score.homeGoals - score.awayGoals;
}