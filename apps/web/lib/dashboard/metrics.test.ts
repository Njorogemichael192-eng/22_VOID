import { describe, expect, it } from "vitest";
import type { MarketView, OddsView, OpportunityView, ScannerRunView } from "@22void/db";

import { legRows, compareBookmakerOdds, summarizeScanner } from "./metrics";

function odds(
  id: string,
  marketId: string,
  bookmaker: string,
  outcome: string,
  odds: number
): OddsView {
  return {
    id,
    marketId,
    bookmaker,
    outcome,
    odds,
    sourceUpdatedAt: "2026-09-22T11:59:00.000Z",
    observedAt: "2026-09-22T11:59:00.000Z",
  };
}

const opp: OpportunityView = {
  id: "opp_1",
  event: {
    id: "evt_1",
    competition: "League",
    homeTeam: "Home",
    awayTeam: "Away",
    startTime: "2026-10-01T19:00:00.000Z",
    status: "SCHEDULED",
  },
  status: "VERIFIED_ARB",
  rejectionReason: null,
  marketStructure: "SAME_MARKET_COMPLEMENT",
  totalStake: 100,
  minReturn: 105,
  guaranteedProfit: 5,
  roi: 0.05,
  worstState: null,
  engineVersion: "1.2.0",
  normalizerVersion: "1.0.0",
  settlementVersion: "1.0.0",
  optimizerVersion: "1.0.0",
  detectedAt: "2026-09-22T11:58:00.000Z",
  validatedAt: "2026-09-22T11:58:05.000Z",
  expiresAt: "2026-09-22T11:58:15.000Z",
  legs: [
    {
      id: "oleg_1",
      selectionId: "sel_over",
      bookmaker: "Pinnacle",
      market: {
        family: "MATCH_TOTAL",
        marketType: "GOALS_OVER_UNDER",
        period: "FULL_MATCH",
        participant: null,
        line: "2.5",
      },
      outcome: "OVER",
      oddsSnapshot: 2.1,
      stake: 50,
      guaranteedReturn: 105,
      settlementResult: null,
    },
    {
      id: "oleg_2",
      selectionId: "sel_under",
      bookmaker: "Bet365",
      market: {
        family: "MATCH_TOTAL",
        marketType: "GOALS_OVER_UNDER",
        period: "FULL_MATCH",
        participant: null,
        line: "2.5",
      },
      outcome: "UNDER",
      oddsSnapshot: 2.1,
      stake: 50,
      guaranteedReturn: 105,
      settlementResult: null,
    },
  ],
};

describe("legRows", () => {
  it("derives display labels for every leg", () => {
    const rows = legRows(opp);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      bookmaker: "Pinnacle",
      selection: "Over 2.5",
      market: "Goals over/under",
      odds: 2.1,
      stake: 50,
    });
    expect(rows[1]?.selection).toBe("Under 2.5");
  });
});

describe("compareBookmakerOdds", () => {
  const currentMarket: MarketView = {
    id: "mkt_total",
    eventId: "evt_1",
    sourceKey: "pinnacle",
    sourceMarketId: "pm-2",
    period: "FULL_MATCH",
    family: "MATCH_TOTAL",
    marketType: "GOALS_OVER_UNDER",
    participant: null,
    line: "2.5",
    status: "OPEN",
    settlementRuleVersion: 1,
    odds: [
      odds("a", "mkt_total", "Pinnacle", "OVER", 2.1),
      odds("b", "mkt_total", "Bet365", "OVER", 2.2),
      odds("c", "mkt_total", "Pinnacle", "UNDER", 2.1),
      odds("d", "mkt_total", "Bet365", "UNDER", 2.15),
    ],
  };

  it("matches the leg market and flags best and snapshot bookmakers", () => {
    const [comparison] = compareBookmakerOdds(opp, [currentMarket]);
    expect(comparison?.marketLabel).toBe("Goals over/under");
    const over = comparison?.outcomes.find((outcome) => outcome.selection === "Over 2.5");
    const bet365 = over?.cells.find((cell) => cell.bookmaker === "Bet365");
    expect(bet365?.best).toBe(true);
    expect(bet365?.odds).toBe(2.2);
  });

  it("falls back to the snapshot odds when no current prices exist", () => {
    const [comparison] = compareBookmakerOdds(opp, []);
    const over = comparison?.outcomes.find((outcome) => outcome.selection === "Over 2.5");
    expect(comparison?.snapshotBookmaker).toBe("Pinnacle");
    expect(over?.cells[0]?.usedInOpp).toBe(true);
    expect(over?.cells[0]?.odds).toBe(2.1);
  });
});

describe("summarizeScanner", () => {
  const recent: ScannerRunView = {
    runId: "r1",
    sourceKey: null,
    status: "HEALTHY",
    message: null,
    startedAt: "2026-09-22T12:00:00.000Z",
    finishedAt: "2026-09-22T12:00:01.000Z",
  };
  const old: ScannerRunView = {
    ...recent,
    runId: "r2",
    startedAt: "2026-09-22T11:00:00.000Z",
    finishedAt: "2026-09-22T11:00:01.000Z",
  };
  const now = Date.parse("2026-09-22T12:03:00.000Z");

  it("reports healthy without staleness for a fresh run", () => {
    const summary = summarizeScanner([recent], now);
    expect(summary.status).toBe("HEALTHY");
    expect(summary.stale).toBeNull();
    expect(summary.runningRuns).toBe(0);
  });

  it("reports stale beyond the 5 minute window", () => {
    const summary = summarizeScanner([old], now);
    expect(summary.stale).toEqual({ sourceKey: "unknown", since: old.startedAt });
  });

  it("counts in-flight runs", () => {
    const running: ScannerRunView = { ...recent, runId: "r3", finishedAt: null };
    const summary = summarizeScanner([recent, running], now);
    expect(summary.runningRuns).toBe(1);
  });

  it("returns UNKNOWN for no runs", () => {
    const summary = summarizeScanner([], now);
    expect(summary.status).toBe("UNKNOWN");
    expect(summary.lastRunAt).toBeNull();
  });
});
