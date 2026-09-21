/**
 * Representative domain fixtures for Phase 2.
 *
 * Plain data (no imports) so they can be validated by @22void/domain schemas
 * and reused by later phases. Validated in packages/domain/src/fixtures.test.ts.
 */

export const footballEvent = {
  canonicalEventId: "evt-0001",
  sport: "football",
  competition: "English Premier League",
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  startTime: "2026-10-03T19:00:00Z",
  status: "SCHEDULED",
  sourceEventIds: [
    { provider: "provider-a", sourceEventId: "PA-482173" },
    { provider: "provider-b", sourceEventId: "PB-99120X" },
  ],
};

export const liveFootballEvent = {
  canonicalEventId: "evt-0002",
  sport: "football",
  competition: "La Liga",
  homeTeam: "Real Madrid",
  awayTeam: "Barcelona",
  startTime: "2026-09-17T20:45:00Z",
  status: "LIVE",
  sourceEventIds: [{ provider: "provider-b", sourceEventId: "PB-19332" }],
};

export const events = [footballEvent, liveFootballEvent];

export const matchResultMarket = {
  family: "MATCH_RESULT",
  period: "FULL_MATCH",
  marketType: "1X2",
};
export const doubleChanceMarket = {
  family: "DOUBLE_CHANCE",
  period: "FULL_MATCH",
  marketType: "DOUBLE_CHANCE",
};
export const matchTotalMarket = {
  family: "MATCH_TOTAL",
  period: "FULL_MATCH",
  marketType: "STANDARD",
  line: "2.5",
};
export const asianTotalMarket = {
  family: "ASIAN_TOTAL",
  period: "FULL_MATCH",
  marketType: "ASIAN",
  line: "2.0",
};
export const asianHandicapMarket = {
  family: "ASIAN_HANDICAP",
  period: "FULL_MATCH",
  marketType: "HANDICAP",
  participant: "HOME",
  line: "-0.75",
};
export const teamTotalMarket = {
  family: "TEAM_TOTAL",
  period: "FULL_MATCH",
  marketType: "STANDARD",
  participant: "HOME",
  line: "1.5",
};
export const teamAsianTotalMarket = {
  family: "TEAM_ASIAN_TOTAL",
  period: "FULL_MATCH",
  marketType: "ASIAN",
  participant: "AWAY",
  line: "2.25",
};
export const cornersMarket = {
  family: "CORNERS",
  period: "FULL_MATCH",
  marketType: "STANDARD",
  line: "8.5",
};
export const cardsMarket = {
  family: "CARDS",
  period: "FULL_MATCH",
  marketType: "STANDARD",
  line: "3.5",
};
export const bttsMarket = { family: "BTTS", period: "FULL_MATCH", marketType: "BTTS" };
export const exactScoreMarket = {
  family: "EXACT_SCORE",
  period: "FULL_MATCH",
  marketType: "EXACT_SCORE",
};
export const firstHalfTotalMarket = {
  family: "MATCH_TOTAL",
  period: "FIRST_HALF",
  marketType: "STANDARD",
  line: "1.5",
};

export const marketStructures = [
  matchResultMarket,
  doubleChanceMarket,
  matchTotalMarket,
  asianTotalMarket,
  asianHandicapMarket,
  teamTotalMarket,
  teamAsianTotalMarket,
  cornersMarket,
  cardsMarket,
  bttsMarket,
  exactScoreMarket,
  firstHalfTotalMarket,
];

const observedAt = "2026-09-17T12:00:00.000Z";
const sourceUpdatedAt = "2026-09-17T11:59:58.000Z";

const base = {
  bookmakerId: "bm-001",
  oddsSourceId: "provider-a",
  observedAt,
  sourceUpdatedAt,
};

export const selections = [
  { ...base, selectionId: "sel-0001", market: matchResultMarket, outcome: "HOME", odds: 2.1 },
  { ...base, selectionId: "sel-0002", market: matchResultMarket, outcome: "DRAW", odds: 3.4 },
  {
    ...base,
    selectionId: "sel-0003",
    market: doubleChanceMarket,
    bookmakerId: "bm-002",
    oddsSourceId: "provider-b",
    outcome: "HOME_OR_DRAW",
    odds: 1.35,
  },
  { ...base, selectionId: "sel-0004", market: matchTotalMarket, outcome: "OVER", odds: 1.95 },
  {
    ...base,
    selectionId: "sel-0005",
    market: asianTotalMarket,
    bookmakerId: "bm-002",
    oddsSourceId: "provider-b",
    outcome: "UNDER",
    odds: 2.4,
  },
  { ...base, selectionId: "sel-0006", market: asianHandicapMarket, outcome: "HOME", odds: 1.75 },
  { ...base, selectionId: "sel-0007", market: teamTotalMarket, outcome: "OVER", odds: 2.05 },
  { ...base, selectionId: "sel-0008", market: teamAsianTotalMarket, outcome: "UNDER", odds: 1.85 },
  { ...base, selectionId: "sel-0009", market: cornersMarket, outcome: "OVER", odds: 1.9 },
  { ...base, selectionId: "sel-0010", market: bttsMarket, outcome: "BTTS_YES", odds: 1.8 },
  { ...base, selectionId: "sel-0011", market: exactScoreMarket, outcome: "2-1", odds: 8.5 },
];

export const settlementStates = [
  { result: "FULL_WIN", components: ["WIN", "WIN"] },
  { result: "HALF_WIN", components: ["WIN", "PUSH"] },
  { result: "FULL_LOSS", components: ["LOSS", "LOSS"] },
  { result: "HALF_LOSS", components: ["PUSH", "LOSS"] },
  { result: "PUSH", components: ["PUSH", "PUSH"] },
  { result: "VOID", components: ["VOID", "VOID"] },
];

export const freshnessRecords = [
  {
    sourceUpdatedAt: "2026-09-17T11:59:55.000Z",
    ingestedAt: "2026-09-17T11:59:55.500Z",
    ageMs: 1_000,
    score: "FRESH",
  },
  {
    sourceUpdatedAt: "2026-09-17T11:59:48.000Z",
    ingestedAt: "2026-09-17T11:59:48.500Z",
    ageMs: 8_000,
    score: "AGING",
  },
  {
    sourceUpdatedAt: "2026-09-17T11:59:36.000Z",
    ingestedAt: "2026-09-17T11:59:36.500Z",
    ageMs: 20_000,
    score: "STALE",
  },
];

export const validOdds = [1.35, 1.95, 2.4, 3.75, 8.5, 11.0];

export const fixtures = {
  events,
  markets: marketStructures,
  selections,
  settlementStates,
  freshness: freshnessRecords,
  validOdds,
};
