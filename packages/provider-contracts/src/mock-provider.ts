import { MarketFamily, MarketType, Participant, Period, SelectionOutcome } from "@22void/domain";

import { providerEnvelopeSchema } from "./envelope";
import type { ProviderEnvelope, ProviderHealth } from "./envelope";
import { buildRawPayload, newRequestId } from "./odds-provider";
import type { OddsProvider, PollRequest, PollResult } from "./odds-provider";

/**
 * MockProvider — deterministic in-memory provider (Phase 3).
 *
 * Serves a fixture envelope exercising every supported canonical family (1X2,
 * double chance, match totals, Asian totals, Asian handicaps, team totals,
 * team Asian totals, corners, cards, BTTS, exact score, period markets) across
 * several bookmakers with per-price source timestamps. This is the data the
 * engine phases 4-10 run against until live feeds are verified in production.
 *
 * No randomness: the emitted envelope is a pure function of `now`.
 */

function toIso(nowMs: number, secondsAgo: number): string {
  return new Date(nowMs - secondsAgo * 1000).toISOString();
}

interface MockSelectionSpec {
  outcome: string;
  providerOutcome: string;
  odds: number;
  secondsAgo: number;
  point?: string;
}

interface MockPriceSpec {
  bookmakerKey: string;
  bookmakerTitle?: string;
  secondsAgo: number;
  selections: MockSelectionSpec[];
}

interface MockMarketSpec {
  sourceMarketId: string;
  family: MarketFamily;
  marketType: MarketType;
  period: Period;
  participant?: Participant;
  line?: string;
  prices: MockPriceSpec[];
}

interface MockEventSpec {
  providerEventId: string;
  competition: string;
  homeTeam: string;
  awayTeam: string;
  startInHours: number;
  markets: MockMarketSpec[];
}

/** Event A exercises the full market taxonomy across three bookmakers. */
const MILAN_DERBY: MockEventSpec = {
  providerEventId: "mock-seriea-001",
  competition: "Serie A",
  homeTeam: "AC Milan",
  awayTeam: "Inter Milan",
  startInHours: 26,
  markets: [
    {
      sourceMarketId: "match-result",
      family: MarketFamily.MATCH_RESULT,
      marketType: MarketType.ONE_X_TWO,
      period: Period.FULL_MATCH,
      prices: [
        {
          bookmakerKey: "book-a",
          bookmakerTitle: "BookA",
          secondsAgo: 3,
          selections: [
            {
              outcome: SelectionOutcome.HOME,
              providerOutcome: "AC Milan",
              odds: 2.1,
              secondsAgo: 3,
            },
            { outcome: SelectionOutcome.DRAW, providerOutcome: "Draw", odds: 3.4, secondsAgo: 3 },
            {
              outcome: SelectionOutcome.AWAY,
              providerOutcome: "Inter Milan",
              odds: 3.6,
              secondsAgo: 3,
            },
          ],
        },
        {
          bookmakerKey: "book-b",
          bookmakerTitle: "BookB",
          secondsAgo: 8,
          selections: [
            {
              outcome: SelectionOutcome.HOME,
              providerOutcome: "AC Milan",
              odds: 2.05,
              secondsAgo: 8,
            },
            { outcome: SelectionOutcome.DRAW, providerOutcome: "Draw", odds: 3.5, secondsAgo: 8 },
            {
              outcome: SelectionOutcome.AWAY,
              providerOutcome: "Inter Milan",
              odds: 3.55,
              secondsAgo: 8,
            },
          ],
        },
        {
          bookmakerKey: "pinnacle",
          bookmakerTitle: "Pinnacle",
          secondsAgo: 14,
          selections: [
            {
              outcome: SelectionOutcome.HOME,
              providerOutcome: "AC Milan",
              odds: 2.12,
              secondsAgo: 14,
            },
            { outcome: SelectionOutcome.DRAW, providerOutcome: "Draw", odds: 3.3, secondsAgo: 14 },
            {
              outcome: SelectionOutcome.AWAY,
              providerOutcome: "Inter Milan",
              odds: 3.7,
              secondsAgo: 14,
            },
          ],
        },
      ],
    },
    {
      sourceMarketId: "double-chance",
      family: MarketFamily.DOUBLE_CHANCE,
      marketType: MarketType.DOUBLE_CHANCE,
      period: Period.FULL_MATCH,
      prices: [
        {
          bookmakerKey: "book-a",
          bookmakerTitle: "BookA",
          secondsAgo: 4,
          selections: [
            {
              outcome: SelectionOutcome.HOME_OR_DRAW,
              providerOutcome: "1X",
              odds: 1.32,
              secondsAgo: 4,
            },
            {
              outcome: SelectionOutcome.AWAY_OR_DRAW,
              providerOutcome: "X2",
              odds: 1.78,
              secondsAgo: 4,
            },
            {
              outcome: SelectionOutcome.HOME_OR_AWAY,
              providerOutcome: "12",
              odds: 1.3,
              secondsAgo: 4,
            },
          ],
        },
      ],
    },
    {
      sourceMarketId: "match-total-2-5",
      family: MarketFamily.MATCH_TOTAL,
      marketType: MarketType.STANDARD,
      period: Period.FULL_MATCH,
      line: "2.5",
      prices: [
        {
          bookmakerKey: "book-a",
          bookmakerTitle: "BookA",
          secondsAgo: 6,
          selections: [
            {
              outcome: SelectionOutcome.OVER,
              providerOutcome: "Over 2.5",
              odds: 1.95,
              secondsAgo: 6,
            },
            {
              outcome: SelectionOutcome.UNDER,
              providerOutcome: "Under 2.5",
              odds: 1.9,
              secondsAgo: 6,
            },
          ],
        },
        {
          bookmakerKey: "pinnacle",
          bookmakerTitle: "Pinnacle",
          secondsAgo: 12,
          selections: [
            {
              outcome: SelectionOutcome.OVER,
              providerOutcome: "Over 2.5",
              odds: 1.98,
              secondsAgo: 12,
            },
            {
              outcome: SelectionOutcome.UNDER,
              providerOutcome: "Under 2.5",
              odds: 1.87,
              secondsAgo: 12,
            },
          ],
        },
      ],
    },
    {
      sourceMarketId: "asian-total-2-25",
      family: MarketFamily.ASIAN_TOTAL,
      marketType: MarketType.ASIAN,
      period: Period.FULL_MATCH,
      line: "2.25",
      prices: [
        {
          bookmakerKey: "book-b",
          bookmakerTitle: "BookB",
          secondsAgo: 9,
          selections: [
            {
              outcome: SelectionOutcome.OVER,
              providerOutcome: "Over 2.25",
              odds: 1.91,
              secondsAgo: 9,
            },
            {
              outcome: SelectionOutcome.UNDER,
              providerOutcome: "Under 2.25",
              odds: 1.99,
              secondsAgo: 9,
            },
          ],
        },
      ],
    },
    {
      sourceMarketId: "asian-handicap-home-0-75",
      family: MarketFamily.ASIAN_HANDICAP,
      marketType: MarketType.HANDICAP,
      period: Period.FULL_MATCH,
      participant: Participant.HOME,
      line: "-0.75",
      prices: [
        {
          bookmakerKey: "pinnacle",
          bookmakerTitle: "Pinnacle",
          secondsAgo: 15,
          selections: [
            {
              outcome: SelectionOutcome.HOME,
              providerOutcome: "AC Milan -0.75",
              odds: 1.96,
              secondsAgo: 15,
            },
            {
              outcome: SelectionOutcome.AWAY,
              providerOutcome: "Inter Milan +0.75",
              odds: 1.94,
              secondsAgo: 15,
            },
          ],
        },
      ],
    },
    {
      sourceMarketId: "team-total-home-1-5",
      family: MarketFamily.TEAM_TOTAL,
      marketType: MarketType.STANDARD,
      period: Period.FULL_MATCH,
      participant: Participant.HOME,
      line: "1.5",
      prices: [
        {
          bookmakerKey: "book-a",
          bookmakerTitle: "BookA",
          secondsAgo: 5,
          selections: [
            {
              outcome: SelectionOutcome.OVER,
              providerOutcome: "Over 1.5",
              odds: 2.15,
              secondsAgo: 5,
            },
            {
              outcome: SelectionOutcome.UNDER,
              providerOutcome: "Under 1.5",
              odds: 1.7,
              secondsAgo: 5,
            },
          ],
        },
      ],
    },
    {
      sourceMarketId: "team-asian-total-away-1-75",
      family: MarketFamily.TEAM_ASIAN_TOTAL,
      marketType: MarketType.ASIAN,
      period: Period.FULL_MATCH,
      participant: Participant.AWAY,
      line: "1.75",
      prices: [
        {
          bookmakerKey: "book-b",
          bookmakerTitle: "BookB",
          secondsAgo: 10,
          selections: [
            {
              outcome: SelectionOutcome.OVER,
              providerOutcome: "Over 1.75",
              odds: 1.85,
              secondsAgo: 10,
            },
            {
              outcome: SelectionOutcome.UNDER,
              providerOutcome: "Under 1.75",
              odds: 2.0,
              secondsAgo: 10,
            },
          ],
        },
      ],
    },
    {
      sourceMarketId: "corners-9-5",
      family: MarketFamily.CORNERS,
      marketType: MarketType.STANDARD,
      period: Period.FULL_MATCH,
      line: "9.5",
      prices: [
        {
          bookmakerKey: "pinnacle",
          bookmakerTitle: "Pinnacle",
          secondsAgo: 13,
          selections: [
            {
              outcome: SelectionOutcome.OVER,
              providerOutcome: "Over 9.5",
              odds: 1.86,
              secondsAgo: 13,
            },
            {
              outcome: SelectionOutcome.UNDER,
              providerOutcome: "Under 9.5",
              odds: 1.96,
              secondsAgo: 13,
            },
          ],
        },
      ],
    },
    {
      sourceMarketId: "cards-4-5",
      family: MarketFamily.CARDS,
      marketType: MarketType.STANDARD,
      period: Period.FULL_MATCH,
      line: "4.5",
      prices: [
        {
          bookmakerKey: "book-a",
          bookmakerTitle: "BookA",
          secondsAgo: 7,
          selections: [
            {
              outcome: SelectionOutcome.OVER,
              providerOutcome: "Over 4.5",
              odds: 2.05,
              secondsAgo: 7,
            },
            {
              outcome: SelectionOutcome.UNDER,
              providerOutcome: "Under 4.5",
              odds: 1.76,
              secondsAgo: 7,
            },
          ],
        },
      ],
    },
    {
      sourceMarketId: "btts",
      family: MarketFamily.BTTS,
      marketType: MarketType.BTTS,
      period: Period.FULL_MATCH,
      prices: [
        {
          bookmakerKey: "book-b",
          bookmakerTitle: "BookB",
          secondsAgo: 11,
          selections: [
            {
              outcome: SelectionOutcome.BTTS_YES,
              providerOutcome: "Yes",
              odds: 1.62,
              secondsAgo: 11,
            },
            {
              outcome: SelectionOutcome.BTTS_NO,
              providerOutcome: "No",
              odds: 2.25,
              secondsAgo: 11,
            },
          ],
        },
      ],
    },
    {
      sourceMarketId: "exact-score-2-1",
      family: MarketFamily.EXACT_SCORE,
      marketType: MarketType.EXACT_SCORE,
      period: Period.FULL_MATCH,
      prices: [
        {
          bookmakerKey: "book-a",
          bookmakerTitle: "BookA",
          secondsAgo: 6,
          selections: [{ outcome: "2-1", providerOutcome: "2:1", odds: 9.0, secondsAgo: 6 }],
        },
      ],
    },
    {
      sourceMarketId: "first-half-total-1-5",
      family: MarketFamily.MATCH_TOTAL,
      marketType: MarketType.STANDARD,
      period: Period.FIRST_HALF,
      line: "1.5",
      prices: [
        {
          bookmakerKey: "pinnacle",
          bookmakerTitle: "Pinnacle",
          secondsAgo: 16,
          selections: [
            {
              outcome: SelectionOutcome.OVER,
              providerOutcome: "Over 1.5",
              odds: 2.3,
              secondsAgo: 16,
            },
            {
              outcome: SelectionOutcome.UNDER,
              providerOutcome: "Under 1.5",
              odds: 1.62,
              secondsAgo: 16,
            },
          ],
        },
      ],
    },
  ],
};

/** Event B is a minimal second fixture used by candidate/matching tests later. */
const PREMIER_CLASH: MockEventSpec = {
  providerEventId: "mock-epl-002",
  competition: "Premier League",
  homeTeam: "Manchester City",
  awayTeam: "Arsenal",
  startInHours: 30,
  markets: [
    {
      sourceMarketId: "match-result",
      family: MarketFamily.MATCH_RESULT,
      marketType: MarketType.ONE_X_TWO,
      period: Period.FULL_MATCH,
      prices: [
        {
          bookmakerKey: "book-c",
          bookmakerTitle: "BookC",
          secondsAgo: 2,
          selections: [
            {
              outcome: SelectionOutcome.HOME,
              providerOutcome: "Manchester City",
              odds: 1.85,
              secondsAgo: 2,
            },
            { outcome: SelectionOutcome.DRAW, providerOutcome: "Draw", odds: 3.7, secondsAgo: 2 },
            {
              outcome: SelectionOutcome.AWAY,
              providerOutcome: "Arsenal",
              odds: 4.2,
              secondsAgo: 2,
            },
          ],
        },
      ],
    },
    {
      sourceMarketId: "match-total-2-5",
      family: MarketFamily.MATCH_TOTAL,
      marketType: MarketType.STANDARD,
      period: Period.FULL_MATCH,
      line: "2.5",
      prices: [
        {
          bookmakerKey: "book-c",
          bookmakerTitle: "BookC",
          secondsAgo: 4,
          selections: [
            {
              outcome: SelectionOutcome.OVER,
              providerOutcome: "Over 2.5",
              odds: 1.72,
              secondsAgo: 4,
            },
            {
              outcome: SelectionOutcome.UNDER,
              providerOutcome: "Under 2.5",
              odds: 2.12,
              secondsAgo: 4,
            },
          ],
        },
      ],
    },
  ],
};

const MOCK_EVENTS: MockEventSpec[] = [MILAN_DERBY, PREMIER_CLASH];

function renderEvent(spec: MockEventSpec, nowMs: number): ProviderEnvelope["events"][number] {
  const markets = spec.markets.map((market) => ({
    sourceMarketId: market.sourceMarketId,
    family: market.family,
    marketType: market.marketType,
    period: market.period,
    ...(market.participant !== undefined ? { participant: market.participant } : {}),
    ...(market.line !== undefined ? { line: market.line } : {}),
    prices: market.prices.map((priceGroup) => ({
      bookmakerKey: priceGroup.bookmakerKey,
      bookmakerTitle: priceGroup.bookmakerTitle,
      sourceUpdatedAt: toIso(nowMs, priceGroup.secondsAgo),
      selections: priceGroup.selections.map((selection) => ({
        outcome: selection.outcome,
        providerOutcome: selection.providerOutcome,
        odds: selection.odds,
        ...(selection.point !== undefined ? { point: selection.point } : {}),
        sourceUpdatedAt: toIso(nowMs, selection.secondsAgo),
      })),
    })),
  }));

  return {
    providerEventId: spec.providerEventId,
    competition: spec.competition,
    homeTeam: spec.homeTeam,
    awayTeam: spec.awayTeam,
    startTime: new Date(nowMs + spec.startInHours * 3600_000).toISOString(),
    status: "SCHEDULED",
    markets,
  };
}

/** Build the deterministic mock envelope. `now` and `requestId` are injectable. */
export function buildMockEnvelope(
  now: string = new Date().toISOString(),
  requestId = "mock-request-1"
): ProviderEnvelope {
  const nowMs = Date.parse(now);
  const envelope = providerEnvelopeSchema.parse({
    provider: "mock",
    requestId,
    receivedAt: now,
    skippedOutcomes: [],
    events: MOCK_EVENTS.map((event) => renderEvent(event, nowMs)),
  });
  return envelope;
}

export class MockProvider implements OddsProvider {
  readonly providerKey = "mock" as const;

  constructor(private readonly nowProvider: () => string = () => new Date().toISOString()) {}

  async poll(_request?: PollRequest): Promise<PollResult> {
    void _request;
    const receivedAt = this.nowProvider();
    const requestId = newRequestId();
    const envelope = buildMockEnvelope(receivedAt, requestId);
    return {
      envelope,
      rawPayload: buildRawPayload(this.providerKey, receivedAt, envelope, requestId, "/mock"),
    };
  }

  async health(): Promise<ProviderHealth> {
    return {
      provider: this.providerKey,
      reachable: true,
      latencyMs: 0,
      checkedAt: this.nowProvider(),
    };
  }
}
