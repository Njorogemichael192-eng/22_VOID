/**
 * Football score primitives (spec §16–§20).
 *
 * A football score is the pair (homeGoals, awayGoals); the total `T = H + A`
 * drives totals markets and the margin `H − A` drives result/handicap markets.
 * Corner and card counts reuse the same home/away shape.
 */

/** Football full-match score state: (homeGoals, awayGoals). */
export interface FootballScore {
  homeGoals: number;
  awayGoals: number;
}

/** A home/away count pair used by corner and card markets. */
export interface MetricCounts {
  home: number;
  away: number;
}

/** Returns the match total for a football score. */
export function matchTotal(score: FootballScore): number {
  return score.homeGoals + score.awayGoals;
}

/** Returns the goal margin (home minus away) used by handicaps. */
export function goalMargin(score: FootballScore): number {
  return score.homeGoals - score.awayGoals;
}

/** Returns the combined total for a home/away count pair. */
export function metricTotal(counts: MetricCounts): number {
  return counts.home + counts.away;
}
