/**
 * Golden score events for outcome-state / settlement regression (Phase 17).
 *
 * Each row is a finished football score with its canonical metric projections
 * (total goals, goal margin) plus corner/card counts. Suites feed these through
 * the outcome engine and the settlement engine to verify state-classification
 * behaviour including Asian push boundaries and both-loss scores.
 */

export interface ScoreLineInput {
  home: number;
  away: number;
}

export interface GoldenScoreEvent {
  id: string;
  label: string;
  fullTime: ScoreLineInput;
  /** Expected total goals (H+A). */
  total: number;
  /** Expected goal margin (H−A). */
  margin: number;
  firstHalf?: ScoreLineInput;
  corners?: ScoreLineInput;
  cards?: ScoreLineInput;
}

export const goldenScoreEvents: GoldenScoreEvent[] = [
  {
    id: "score-0-0",
    label: "0-0",
    fullTime: { home: 0, away: 0 },
    total: 0,
    margin: 0,
    corners: { home: 2, away: 3 },
    cards: { home: 0, away: 1 },
  },
  {
    id: "score-1-1",
    label: "1-1",
    fullTime: { home: 1, away: 1 },
    total: 2,
    margin: 0,
  },
  {
    id: "score-2-0",
    label: "2-0",
    fullTime: { home: 2, away: 0 },
    total: 2,
    margin: 2,
  },
  {
    id: "score-0-2",
    label: "0-2",
    fullTime: { home: 0, away: 2 },
    total: 2,
    margin: -2,
  },
  {
    id: "score-1-0",
    label: "1-0",
    fullTime: { home: 1, away: 0 },
    total: 1,
    margin: 1,
  },
  {
    id: "score-0-1",
    label: "0-1",
    fullTime: { home: 0, away: 1 },
    total: 1,
    margin: -1,
  },
  {
    id: "score-2-1",
    label: "2-1",
    fullTime: { home: 2, away: 1 },
    total: 3,
    margin: 1,
    firstHalf: { home: 1, away: 1 },
  },
  {
    id: "score-3-3",
    label: "3-3",
    fullTime: { home: 3, away: 3 },
    total: 6,
    margin: 0,
  },
  {
    id: "score-5-4",
    label: "5-4",
    fullTime: { home: 5, away: 4 },
    total: 9,
    margin: 1,
  },
  {
    id: "score-6-5",
    label: "6-5",
    fullTime: { home: 6, away: 5 },
    total: 11,
    margin: 1,
  },
  {
    id: "score-11-13",
    label: "11-13",
    fullTime: { home: 11, away: 13 },
    total: 24,
    margin: -2,
  },
];

/** The score an Asian-push regression needs: total exactly 2 (1-1). */
export const SCORE_TOTAL_TWO: GoldenScoreEvent = {
  id: "score-total-2",
  label: "total exactly 2",
  fullTime: { home: 1, away: 1 },
  total: 2,
  margin: 0,
};

/** The score an away-by-one handicap-push regression needs. */
export const SCORE_AWAY_BY_ONE: GoldenScoreEvent = {
  id: "score-away-by-1",
  label: "away wins by exactly 1",
  fullTime: { home: 0, away: 1 },
  total: 1,
  margin: -1,
};