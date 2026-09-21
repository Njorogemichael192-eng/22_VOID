import { EventStatus, MarketFamily, MarketType, Participant, Period } from "@22void/domain";
import { describe, expect, it } from "vitest";

import { ODDS_API_SOCCER_RAW } from "../../../../tests/fixtures/providers/raw-odds-api";
import { PARLAY_API_SOCCER_RAW } from "../../../../tests/fixtures/providers/raw-parlay-api";
import { ODDS_API_MARKET_KEYS, PARLAY_API_MARKET_KEYS } from "./keys";
import {
  extractLineFromLabel,
  formatLine,
  inferLine,
  splitTeamTotals,
  translateProviderOdds,
} from "./translate";
import type { WireEvent, WireMarket } from "./translate";

const RECEIVED_AT = "2026-11-21T08:00:00.000Z";
const REQUEST_ID = "req-test-1";

describe("translateProviderOdds with the Odds-API.io fixture", () => {
  const translated = translateProviderOdds(
    ODDS_API_SOCCER_RAW,
    ODDS_API_MARKET_KEYS,
    "odds-api",
    REQUEST_ID,
    RECEIVED_AT
  );

  it("translates both fixture events", () => {
    expect(translated.events).toHaveLength(2);
    expect(translated.events[0]?.homeTeam).toBe("Manchester City");
    expect(translated.events[0]?.awayTeam).toBe("Arsenal");
  });

  it("maps h2h outcomes to HOME/DRAW/AWAY per bookmaker", () => {
    const resultMarkets = translated.events[0]?.markets.filter(
      (m) => m.family === MarketFamily.MATCH_RESULT
    );
    expect(resultMarkets).toHaveLength(2);
    const pinnacle = resultMarkets?.find((m) => m.prices[0]?.bookmakerKey === "pinnacle");
    expect(pinnacle?.prices[0]?.selections.map((s) => s.outcome)).toEqual(["HOME", "AWAY", "DRAW"]);
  });

  it("derives the totals line from the label when point is absent", () => {
    const totals = translated.events[0]?.markets.filter(
      (m) => m.family === MarketFamily.MATCH_TOTAL
    );
    expect(totals).toHaveLength(2);
    for (const market of totals ?? []) {
      expect(market.line).toBe("2.5");
      expect(market.prices[0]?.selections.map((s) => s.outcome)).toEqual(["OVER", "UNDER"]);
    }
  });

  it("splits team_totals_away into a per-participant market", () => {
    const teamTotals = translated.events[0]?.markets.filter(
      (m) => m.family === MarketFamily.TEAM_TOTAL
    );
    expect(teamTotals).toHaveLength(1);
    const market = teamTotals?.[0];
    expect(market?.participant).toBe(Participant.AWAY);
    expect(market?.line).toBe("1.5");
    expect(market?.prices[0]?.selections.map((s) => s.outcome)).toEqual(["OVER", "UNDER"]);
  });

  it("maps extra markets (btts, double chance) and reports unknown markets", () => {
    expect(translated.events[0]?.markets.some((m) => m.family === MarketFamily.BTTS)).toBe(true);
    expect(translated.events[0]?.markets.some((m) => m.family === MarketFamily.DOUBLE_CHANCE)).toBe(
      true
    );
    expect(translated.skippedOutcomes).toContain("williamhill:player_goals_anytime:unknown_market");
  });

  it("carries provider source timestamps and the ingest timestamp", () => {
    expect(translated.receivedAt).toBe(RECEIVED_AT);
    expect(translated.events[0]?.markets[0]?.prices[0]?.sourceUpdatedAt).toBe(
      "2026-11-20T18:01:00.000Z"
    );
  });

  it("propagates the live status for in-play events", () => {
    const liveTranslated = translateProviderOdds(
      ODDS_API_SOCCER_RAW,
      ODDS_API_MARKET_KEYS,
      "odds-api",
      REQUEST_ID,
      RECEIVED_AT,
      undefined,
      (event) => (event.status === "live" ? EventStatus.LIVE : EventStatus.SCHEDULED)
    );
    expect(liveTranslated.events[1]?.providerEventId).toBe("oddsepl002");
    expect(liveTranslated.events[1]?.status).toBe("LIVE");
  });
});

describe("translateProviderOdds with the ParlayAPI fixture", () => {
  const translated = translateProviderOdds(
    PARLAY_API_SOCCER_RAW,
    PARLAY_API_MARKET_KEYS,
    "parlay-api",
    REQUEST_ID,
    RECEIVED_AT
  );

  it("maps the h2h_3_way market and splits team_totals_home", () => {
    const event = translated.events[0];
    expect(event?.markets.length).toBe(6);
    const teamTotals = event?.markets.find((m) => m.family === MarketFamily.TEAM_TOTAL);
    expect(teamTotals?.participant).toBe(Participant.HOME);
    expect(teamTotals?.line).toBe("1.5");
  });

  it("maps correct score to the canonical score string", () => {
    const exact = translated.events[0]?.markets.find((m) => m.family === MarketFamily.EXACT_SCORE);
    expect(exact?.prices[0]?.selections[0]?.outcome).toBe("2-1");
    expect(exact?.prices[0]?.selections[0]?.providerOutcome).toBe("2-1");
  });

  it("skips nothing for a fully-supported fixture", () => {
    expect(translated.skippedOutcomes).toHaveLength(0);
  });
});

describe("outcome and line mapping edge cases", () => {
  const wire: WireEvent = {
    id: "edge-1",
    sport_title: "Russia - Premier League",
    commence_time: "2026-12-01T17:00:00.000Z",
    home_team: "Spartak Moscow",
    away_team: "CSKA Moscow",
    bookmakers: [
      {
        key: "bk",
        last_update: RECEIVED_AT,
        markets: [
          { key: "h2h", outcomes: [{ name: "П2", price: 2.2 }] },
          { key: "totals", outcomes: [{ name: "Over 2,5", price: 1.9 }] },
          { key: "totals", outcomes: [{ name: "Over 2.5", price: 0.9 }] },
          { key: "totals", outcomes: [{ name: "Over 3.5", price: 2.4 }] },
        ],
      },
    ],
  };

  it("maps Russian П2 label to AWAY", () => {
    const translated = translateProviderOdds(
      [wire],
      ODDS_API_MARKET_KEYS,
      "odds-api",
      REQUEST_ID,
      RECEIVED_AT
    );
    const result = translated.events[0]?.markets.find(
      (m) => m.family === MarketFamily.MATCH_RESULT
    );
    expect(result?.prices[0]?.selections[0]?.outcome).toBe("AWAY");
  });

  it("normalizes a comma decimal line label and rejects non-sharp prices", () => {
    const translated = translateProviderOdds(
      [wire],
      ODDS_API_MARKET_KEYS,
      "odds-api",
      REQUEST_ID,
      RECEIVED_AT
    );
    const totals = translated.events[0]?.markets.filter(
      (m) => m.family === MarketFamily.MATCH_TOTAL
    );
    const over25 = totals?.find((m) => m.line === "2.5");
    const over35 = totals?.find((m) => m.line === "3.5");
    expect(over25?.prices[0]?.selections.map((s) => s.outcome)).toEqual(["OVER"]);
    expect(over35?.prices[0]?.selections.map((s) => s.outcome)).toEqual(["OVER"]);
    expect(translated.skippedOutcomes).toContain("bk:totals:Over 2.5");
  });

  it("skips markets with no provider timestamp", () => {
    const noTimestamp: WireEvent = {
      ...wire,
      bookmakers: [
        {
          key: "bk",
          markets: [{ key: "h2h", outcomes: [{ name: "Spartak Moscow", price: 1.5 }] }],
        },
      ],
    };
    const translated = translateProviderOdds(
      [noTimestamp],
      ODDS_API_MARKET_KEYS,
      "odds-api",
      REQUEST_ID,
      RECEIVED_AT
    );
    expect(translated.events[0]?.markets).toHaveLength(0);
    expect(translated.skippedOutcomes).toContain("bk:h2h:missing_timestamp");
  });

  it("uses the outcome point for Asian-style fractional lines", () => {
    const registry = {
      asian_totals: {
        family: MarketFamily.ASIAN_TOTAL,
        marketType: MarketType.ASIAN,
        period: Period.FULL_MATCH,
        usesPoint: true,
      },
    };
    const wire: WireEvent = {
      id: "asian-1",
      commence_time: "2026-12-01T17:00:00.000Z",
      home_team: "A",
      away_team: "B",
      bookmakers: [
        {
          key: "bk",
          markets: [
            {
              key: "asian_totals",
              last_update: RECEIVED_AT,
              outcomes: [
                { name: "Over", price: 1.91, point: 2.25 },
                { name: "Under", price: 1.99, point: 2.25 },
              ],
            },
          ],
        },
      ],
    };
    const translated = translateProviderOdds([wire], registry, "mock", REQUEST_ID, RECEIVED_AT);
    const market = translated.events[0]?.markets[0];
    expect(market?.line).toBe("2.25");
    expect(market?.prices[0]?.selections.map((s) => s.point)).toEqual(["2.25", "2.25"]);
  });
});

describe("line helpers", () => {
  it("extractLineFromLabel handles the trailing number", () => {
    expect(extractLineFromLabel("Over 2.5")).toBe("2.5");
    expect(extractLineFromLabel("Under 2,5")).toBe("2.5");
    expect(extractLineFromLabel("AC Milan -0.75")).toBe("-0.75");
    expect(extractLineFromLabel("Draw")).toBeNull();
  });

  it("formatLine canonicalizes numeric points", () => {
    expect(formatLine(2.5)).toBe("2.5");
    expect(formatLine("-0.75")).toBe("-0.75");
    expect(formatLine("0.5")).toBe("0.5");
    expect(formatLine(undefined)).toBeNull();
    expect(formatLine("1/2")).toBeNull();
  });

  it("inferLine prefers point over label, then falls back to label", () => {
    expect(inferLine({ name: "Over X", price: 1.9, point: 2.75 })).toBe("2.75");
    expect(inferLine({ name: "Over 2.5", price: 1.9 })).toBe("2.5");
    expect(inferLine({ name: "Draw", price: 1.9 })).toBeNull();
  });
});

describe("splitTeamTotals", () => {
  const ctx = { homeTeam: "H", awayTeam: "A" };
  it("groups by participant and line using point", () => {
    const market: WireMarket = {
      key: "team_totals_home",
      outcomes: [
        { name: "Over", price: 1.9, point: 1.5 },
        { name: "Under", price: 1.9, point: 1.5 },
      ],
    };
    const groups = splitTeamTotals(market, ctx, Participant.HOME);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.participant).toBe(Participant.HOME);
    expect(groups[0]?.line).toBe("1.5");
    expect(groups[0]?.outcomes).toHaveLength(2);
  });

  it("skips outcomes with no resolvable line", () => {
    const market: WireMarket = {
      key: "team_totals_home",
      outcomes: [{ name: "Over", price: 1.9 }],
    };
    const groups = splitTeamTotals(market, ctx, Participant.HOME);
    expect(groups).toHaveLength(0);
  });
});
