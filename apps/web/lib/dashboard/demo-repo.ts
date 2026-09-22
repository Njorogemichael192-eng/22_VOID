/**
 * In-memory `ApiRepo` with deterministic seed fixtures (Phase 13).
 *
 * Used by the dashboard when `DASHBOARD_SOURCE=demo` (or when no DATABASE_URL
 * is configured), so the full opportunity-inspection flow runs in CI, e2e and
 * on a fresh checkout without Postgres. Each seed is built relative to a `now`
 * anchor, giving stable fresh/stale/expired examples.
 */

import type {
  AdminSourceView,
  ApiRepo,
  Cursor,
  EventFilter,
  EventView,
  MarketFilter,
  MarketView,
  OddsFilter,
  OddsView,
  OpportunityFilter,
  OpportunityView,
  Page,
  ProviderView,
  ScannerRunView,
} from "@22void/db";

export interface DemoSeed {
  events: EventView[];
  markets: MarketView[];
  odds: OddsView[];
  opportunities: OpportunityView[];
  providers: ProviderView[];
  scannerRuns: ScannerRunView[];
  adminSources: AdminSourceView[];
}

function iso(now: number, agoMs: number): string {
  return new Date(now - agoMs).toISOString();
}

function future(now: number, aheadMs: number): string {
  return new Date(now + aheadMs).toISOString();
}

function oddsRow(
  id: string,
  marketId: string,
  bookmaker: string,
  outcome: string,
  odds: number,
  updatedAt: string
): OddsView {
  return {
    id,
    marketId,
    bookmaker,
    outcome,
    odds,
    sourceUpdatedAt: updatedAt,
    observedAt: updatedAt,
  };
}

export function buildDemoSeed(now: number): DemoSeed {
  const events: EventView[] = [
    {
      id: "evt_ars_che",
      canonicalEventId: "evt_ars_che",
      sport: "football",
      competition: "English Premier League",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      startTime: future(now, 2 * 60 * 60 * 1000),
      status: "SCHEDULED",
      sourceLinks: [
        { sourceKey: "odds-api", sourceEventId: "socc:1082" },
        { sourceKey: "pinnacle", sourceEventId: "src_1082" },
      ],
    },
    {
      id: "evt_mci_liv",
      canonicalEventId: "evt_mci_liv",
      sport: "football",
      competition: "UEFA Champions League",
      homeTeam: "Manchester City",
      awayTeam: "Liverpool",
      startTime: future(now, 19 * 60 * 60 * 1000),
      status: "SCHEDULED",
      sourceLinks: [{ sourceKey: "odds-api", sourceEventId: "socc:2091" }],
    },
    {
      id: "evt_int_juv",
      canonicalEventId: "evt_int_juv",
      sport: "football",
      competition: "Serie A",
      homeTeam: "Inter",
      awayTeam: "Juventus",
      startTime: iso(now, 70 * 60 * 1000),
      status: "LIVE",
      sourceLinks: [{ sourceKey: "odds-api", sourceEventId: "socc:3310" }],
    },
    {
      id: "evt_rma_bar",
      canonicalEventId: "evt_rma_bar",
      sport: "football",
      competition: "La Liga",
      homeTeam: "Real Madrid",
      awayTeam: "Barcelona",
      startTime: future(now, 5 * 24 * 60 * 60 * 1000),
      status: "SCHEDULED",
      sourceLinks: [{ sourceKey: "odds-api", sourceEventId: "socc:448" }],
    },
  ];

  const markets: MarketView[] = [
    {
      id: "mkt_ars_1x2",
      eventId: "evt_ars_che",
      sourceKey: "pinnacle",
      sourceMarketId: "pm-1",
      period: "FULL_MATCH",
      family: "MATCH_RESULT",
      marketType: "1X2",
      participant: null,
      line: null,
      status: "OPEN",
      settlementRuleVersion: 1,
      odds: [],
    },
    {
      id: "mkt_ars_total",
      eventId: "evt_ars_che",
      sourceKey: "pinnacle",
      sourceMarketId: "pm-2",
      period: "FULL_MATCH",
      family: "MATCH_TOTAL",
      marketType: "GOALS_OVER_UNDER",
      participant: null,
      line: "2.5",
      status: "OPEN",
      settlementRuleVersion: 1,
      odds: [],
    },
    {
      id: "mkt_ars_hcap",
      eventId: "evt_ars_che",
      sourceKey: "pinnacle",
      sourceMarketId: "pm-3",
      period: "FULL_MATCH",
      family: "ASIAN_HANDICAP",
      marketType: "ASIAN_HANDICAP",
      participant: null,
      line: "-0.75",
      status: "OPEN",
      settlementRuleVersion: 1,
      odds: [],
    },
    {
      id: "mkt_mci_total",
      eventId: "evt_mci_liv",
      sourceKey: "pinnacle",
      sourceMarketId: "pm-4",
      period: "FULL_MATCH",
      family: "MATCH_TOTAL",
      marketType: "GOALS_OVER_UNDER",
      participant: null,
      line: "2.5",
      status: "OPEN",
      settlementRuleVersion: 1,
      odds: [],
    },
    {
      id: "mkt_mci_team",
      eventId: "evt_mci_liv",
      sourceKey: "pinnacle",
      sourceMarketId: "pm-5",
      period: "FULL_MATCH",
      family: "TEAM_TOTAL",
      marketType: "TEAM_TOTAL",
      participant: "HOME",
      line: "1.5",
      status: "OPEN",
      settlementRuleVersion: 1,
      odds: [],
    },
    {
      id: "mkt_int_handicap",
      eventId: "evt_int_juv",
      sourceKey: "pinnacle",
      sourceMarketId: "pm-6",
      period: "FULL_MATCH",
      family: "ASIAN_HANDICAP",
      marketType: "ASIAN_HANDICAP",
      participant: null,
      line: "0",
      status: "OPEN",
      settlementRuleVersion: 1,
      odds: [],
    },
  ];

  const odds: OddsView[] = [
    // Arsenal vs Chelsea 1X2 (partition example)
    oddsRow("sel_ars_home", "mkt_ars_1x2", "Pinnacle", "HOME", 3.1, iso(now, 30 * 1000)),
    oddsRow("sel_ars_draw", "mkt_ars_1x2", "Bet365", "DRAW", 3.3, iso(now, 40 * 1000)),
    oddsRow("sel_ars_away", "mkt_ars_1x2", "Unibet", "AWAY", 2.9, iso(now, 45 * 1000)),
    // Arsenal vs Chelsea totals (same-market complement)
    oddsRow("sel_ars_over", "mkt_ars_total", "Pinnacle", "OVER", 2.1, iso(now, 30 * 1000)),
    oddsRow("sel_ars_under", "mkt_ars_total", "Bet365", "UNDER", 2.15, iso(now, 40 * 1000)),
    oddsRow("sel_ars_over_u", "mkt_ars_total", "Unibet", "OVER", 2.02, iso(now, 12 * 60 * 1000)),
    // Asian handicap -0.75
    oddsRow("sel_ars_hminus", "mkt_ars_hcap", "Pinnacle", "HOME", 2.0, iso(now, 30 * 1000)),
    oddsRow("sel_ars_aplus", "mkt_ars_hcap", "Bet365", "AWAY", 2.05, iso(now, 40 * 1000)),
    // Man City vs Liverpool
    oddsRow("sel_mci_over", "mkt_mci_total", "Pinnacle", "OVER", 1.85, iso(now, 80 * 1000)),
    oddsRow("sel_mci_under", "mkt_mci_total", "Bet365", "UNDER", 1.8, iso(now, 90 * 1000)),
    oddsRow("sel_mci_team_home", "mkt_mci_team", "Unibet", "OVER", 2.05, iso(now, 15 * 1000)),
    // Inter vs Juventus
    oddsRow("sel_int_home", "mkt_int_handicap", "Pinnacle", "HOME", 1.95, iso(now, 60 * 60 * 1000)),
    oddsRow("sel_int_away", "mkt_int_handicap", "Bet365", "AWAY", 1.92, iso(now, 70 * 60 * 1000)),
  ];

  const opportunities: OpportunityView[] = [
    {
      id: "opp_verified_totals",
      event: {
        id: "evt_ars_che",
        competition: "English Premier League",
        homeTeam: "Arsenal",
        awayTeam: "Chelsea",
        startTime: future(now, 2 * 60 * 60 * 1000),
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
      detectedAt: iso(now, 20 * 1000),
      validatedAt: iso(now, 15 * 1000),
      expiresAt: future(now, 10 * 1000),
      legs: [
        {
          id: "oleg_1",
          selectionId: "sel_ars_over",
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
          selectionId: "sel_ars_under",
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
    },
    {
      id: "opp_verified_1x2",
      event: {
        id: "evt_ars_che",
        competition: "English Premier League",
        homeTeam: "Arsenal",
        awayTeam: "Chelsea",
        startTime: future(now, 2 * 60 * 60 * 1000),
        status: "SCHEDULED",
      },
      status: "VERIFIED_ARB",
      rejectionReason: null,
      marketStructure: "PARTITION",
      totalStake: 101.9,
      minReturn: 105,
      guaranteedProfit: 3.1,
      roi: 0.0304,
      worstState: null,
      engineVersion: "1.2.0",
      normalizerVersion: "1.0.0",
      settlementVersion: "1.0.0",
      optimizerVersion: "1.0.0",
      detectedAt: iso(now, 2 * 60 * 1000),
      validatedAt: iso(now, 95 * 1000),
      expiresAt: future(now, 55 * 1000),
      legs: [
        {
          id: "oleg_10",
          selectionId: "sel_ars_home",
          bookmaker: "Pinnacle",
          market: {
            family: "MATCH_RESULT",
            marketType: "1X2",
            period: "FULL_MATCH",
            participant: null,
            line: null,
          },
          outcome: "HOME",
          oddsSnapshot: 3.1,
          stake: 33.87,
          guaranteedReturn: 105,
          settlementResult: null,
        },
        {
          id: "oleg_11",
          selectionId: "sel_ars_draw",
          bookmaker: "Bet365",
          market: {
            family: "MATCH_RESULT",
            marketType: "1X2",
            period: "FULL_MATCH",
            participant: null,
            line: null,
          },
          outcome: "DRAW",
          oddsSnapshot: 3.3,
          stake: 31.82,
          guaranteedReturn: 105,
          settlementResult: null,
        },
        {
          id: "oleg_12",
          selectionId: "sel_ars_away",
          bookmaker: "Unibet",
          market: {
            family: "MATCH_RESULT",
            marketType: "1X2",
            period: "FULL_MATCH",
            participant: null,
            line: null,
          },
          outcome: "AWAY",
          oddsSnapshot: 2.9,
          stake: 36.21,
          guaranteedReturn: 105,
          settlementResult: null,
        },
      ],
    },
    {
      id: "opp_fresh_team_total",
      event: {
        id: "evt_mci_liv",
        competition: "UEFA Champions League",
        homeTeam: "Manchester City",
        awayTeam: "Liverpool",
        startTime: future(now, 19 * 60 * 60 * 1000),
        status: "SCHEDULED",
      },
      status: "FRESH_ARB",
      rejectionReason: null,
      marketStructure: "TEAM_TOTAL_MATCH_TOTAL",
      totalStake: 100,
      minReturn: 102.5,
      guaranteedProfit: 2.5,
      roi: 0.025,
      worstState: null,
      engineVersion: "1.2.0",
      normalizerVersion: "1.0.0",
      settlementVersion: "1.0.0",
      optimizerVersion: "1.0.0",
      detectedAt: iso(now, 5 * 1000),
      validatedAt: null,
      expiresAt: future(now, 25 * 1000),
      legs: [
        {
          id: "oleg_13",
          selectionId: "sel_mci_team_home",
          bookmaker: "Unibet",
          market: {
            family: "TEAM_TOTAL",
            marketType: "TEAM_TOTAL",
            period: "FULL_MATCH",
            participant: "HOME",
            line: "1.5",
          },
          outcome: "OVER",
          oddsSnapshot: 2.05,
          stake: 50,
          guaranteedReturn: 102.5,
          settlementResult: null,
        },
        {
          id: "oleg_14",
          selectionId: "sel_mci_over",
          bookmaker: "Pinnacle",
          market: {
            family: "MATCH_TOTAL",
            marketType: "GOALS_OVER_UNDER",
            period: "FULL_MATCH",
            participant: null,
            line: "2.5",
          },
          outcome: "OVER",
          oddsSnapshot: 2.05,
          stake: 50,
          guaranteedReturn: 102.5,
          settlementResult: null,
        },
      ],
    },
    {
      id: "opp_theoretical_totals",
      event: {
        id: "evt_mci_liv",
        competition: "UEFA Champions League",
        homeTeam: "Manchester City",
        awayTeam: "Liverpool",
        startTime: future(now, 19 * 60 * 60 * 1000),
        status: "SCHEDULED",
      },
      status: "THEORETICAL_ARB",
      rejectionReason: null,
      marketStructure: "COMPLEMENTARY_TOTALS",
      totalStake: 100,
      minReturn: 100.8,
      guaranteedProfit: 0.8,
      roi: 0.008,
      worstState: null,
      engineVersion: "1.2.0",
      normalizerVersion: null,
      settlementVersion: null,
      optimizerVersion: "1.0.0",
      detectedAt: iso(now, 4 * 60 * 1000),
      validatedAt: null,
      expiresAt: null,
      legs: [
        {
          id: "oleg_15",
          selectionId: "sel_mci_over",
          bookmaker: "Pinnacle",
          market: {
            family: "MATCH_TOTAL",
            marketType: "GOALS_OVER_UNDER",
            period: "FULL_MATCH",
            participant: null,
            line: "2.0",
          },
          outcome: "OVER",
          oddsSnapshot: 1.85,
          stake: 54.05,
          guaranteedReturn: 100,
          settlementResult: null,
        },
        {
          id: "oleg_16",
          selectionId: "sel_mci_under",
          bookmaker: "Bet365",
          market: {
            family: "MATCH_TOTAL",
            marketType: "GOALS_OVER_UNDER",
            period: "FULL_MATCH",
            participant: null,
            line: "2.5",
          },
          outcome: "UNDER",
          oddsSnapshot: 1.8,
          stake: 55.56,
          guaranteedReturn: 100,
          settlementResult: null,
        },
      ],
    },
    {
      id: "opp_rejected_handicap",
      event: {
        id: "evt_int_juv",
        competition: "Serie A",
        homeTeam: "Inter",
        awayTeam: "Juventus",
        startTime: iso(now, 70 * 60 * 1000),
        status: "LIVE",
      },
      status: "REJECTED",
      rejectionReason: "NEGATIVE_GUARANTEED_PROFIT",
      marketStructure: "ASIAN_LINE",
      totalStake: null,
      minReturn: null,
      guaranteedProfit: null,
      roi: null,
      worstState: null,
      engineVersion: "1.2.0",
      normalizerVersion: "1.0.0",
      settlementVersion: "1.0.0",
      optimizerVersion: "1.0.0",
      detectedAt: iso(now, 2 * 60 * 60 * 1000),
      validatedAt: null,
      expiresAt: null,
      legs: [
        {
          id: "oleg_17",
          selectionId: "sel_int_home",
          bookmaker: "Pinnacle",
          market: {
            family: "ASIAN_HANDICAP",
            marketType: "ASIAN_HANDICAP",
            period: "FULL_MATCH",
            participant: null,
            line: "0",
          },
          outcome: "HOME",
          oddsSnapshot: 1.95,
          stake: null,
          guaranteedReturn: null,
          settlementResult: null,
        },
        {
          id: "oleg_18",
          selectionId: "sel_int_away",
          bookmaker: "Bet365",
          market: {
            family: "ASIAN_HANDICAP",
            marketType: "ASIAN_HANDICAP",
            period: "FULL_MATCH",
            participant: null,
            line: "0",
          },
          outcome: "AWAY",
          oddsSnapshot: 1.92,
          stake: null,
          guaranteedReturn: null,
          settlementResult: null,
        },
      ],
    },
    {
      id: "opp_stale_legacy",
      event: {
        id: "evt_rma_bar",
        competition: "La Liga",
        homeTeam: "Real Madrid",
        awayTeam: "Barcelona",
        startTime: future(now, 5 * 24 * 60 * 60 * 1000),
        status: "SCHEDULED",
      },
      status: "STALE",
      rejectionReason: "STALE_ODDS",
      marketStructure: "SAME_MARKET_COMPLEMENT",
      totalStake: null,
      minReturn: null,
      guaranteedProfit: null,
      roi: null,
      worstState: null,
      engineVersion: "1.0.0",
      normalizerVersion: "1.0.0",
      settlementVersion: "1.0.0",
      optimizerVersion: null,
      detectedAt: iso(now, 2 * 24 * 60 * 60 * 1000),
      validatedAt: null,
      expiresAt: null,
      legs: [
        {
          id: "oleg_19",
          selectionId: "sel_legacy_1",
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
          stake: null,
          guaranteedReturn: null,
          settlementResult: null,
        },
        {
          id: "oleg_20",
          selectionId: "sel_legacy_2",
          bookmaker: "Bet365",
          market: {
            family: "MATCH_TOTAL",
            marketType: "GOALS_OVER_UNDER",
            period: "FULL_MATCH",
            participant: null,
            line: "2.5",
          },
          outcome: "UNDER",
          oddsSnapshot: 2.15,
          stake: null,
          guaranteedReturn: null,
          settlementResult: null,
        },
      ],
    },
  ];

  const providers: ProviderView[] = [
    {
      key: "odds-api",
      displayName: "The Odds API",
      baseUrl: "https://api.the-odds-api.com",
      status: "HEALTHY",
      lastSeenAt: iso(now, 45 * 1000),
    },
    {
      key: "pinnacle",
      displayName: "Pinnacle",
      baseUrl: "https://www.pinnacle.com",
      status: "HEALTHY",
      lastSeenAt: iso(now, 30 * 1000),
    },
    {
      key: "bet365",
      displayName: "Bet365",
      baseUrl: null,
      status: "HEALTHY",
      lastSeenAt: iso(now, 90 * 1000),
    },
    {
      key: "unibet",
      displayName: "Unibet",
      baseUrl: "https://www.unibet.com",
      status: "DEGRADED",
      lastSeenAt: iso(now, 14 * 60 * 1000),
    },
  ];

  const scannerRuns: ScannerRunView[] = [
    {
      runId: "scan_1",
      sourceKey: null,
      status: "HEALTHY",
      message: null,
      startedAt: iso(now, 25 * 1000),
      finishedAt: iso(now, 22 * 1000),
    },
    {
      runId: "scan_2",
      sourceKey: "pinnacle",
      status: "HEALTHY",
      message: null,
      startedAt: iso(now, 20 * 60 * 1000),
      finishedAt: iso(now, 20 * 60 * 1000 - 3000),
    },
    {
      runId: "scan_3",
      sourceKey: "odds-api",
      status: "DEGRADED",
      message: "slow response",
      startedAt: iso(now, 25 * 60 * 1000),
      finishedAt: iso(now, 25 * 60 * 1000 - 9000),
    },
  ];

  const adminSources: AdminSourceView[] = providers.map((provider, index) => ({
    ...provider,
    marketCount: [6, 8, 5, 3][index] ?? 0,
    rawPayloadCount: [410, 340, 260, 120][index] ?? 0,
    scannerRunCount: [89, 88, 77, 41][index] ?? 0,
    settlementRuleCount: [6, 6, 4, 3][index] ?? 0,
  }));

  return { events, markets, odds, opportunities, providers, scannerRuns, adminSources };
}

/** Slices a sorted list into a keyset page keyed on id (ascending). */
function pageById<T extends { id: string }>(
  rows: T[],
  cursor: Cursor | null,
  limit: number
): Page<T> {
  const startIndex = cursor === null ? 0 : rows.findIndex((row) => row.id === cursor.id);
  if (startIndex === -1) return { data: [], nextCursor: null };
  const start = cursor !== null ? startIndex + 1 : 0;
  const slice = rows.slice(start, start + limit);
  const hasMore = start + limit < rows.length;
  const last = slice[slice.length - 1];
  return {
    data: slice,
    nextCursor:
      hasMore && last !== undefined ? { value: last.id, direction: 1, id: last.id } : null,
  };
}

export function createDemoRepo(now: number = Date.now()): ApiRepo {
  const seed = buildDemoSeed(now);

  return {
    async listEvents(filter: EventFilter): Promise<Page<EventView>> {
      let rows = [...seed.events];
      if (filter.status !== undefined) {
        rows = rows.filter((event) => event.status === filter.status);
      }
      if (filter.competition !== undefined) {
        rows = rows.filter((event) => event.competition === filter.competition);
      }
      if (filter.team !== undefined) {
        const team = filter.team.toLowerCase();
        rows = rows.filter(
          (event) =>
            event.homeTeam.toLowerCase().includes(team) ||
            event.awayTeam.toLowerCase().includes(team)
        );
      }
      const { startFrom, startTo } = filter;
      if (startFrom !== undefined || startTo !== undefined) {
        rows = rows.filter((event) => {
          if (startFrom !== undefined && event.startTime < startFrom) return false;
          if (startTo !== undefined && event.startTime > startTo) return false;
          return true;
        });
      }
      rows.sort((a, b) => a.id.localeCompare(b.id));
      return pageById(rows, filter.cursor, filter.limit);
    },
    async getEvent(id: string): Promise<EventView | null> {
      return seed.events.find((event) => event.id === id) ?? null;
    },
    async listMarkets(filter: MarketFilter): Promise<Page<MarketView>> {
      let rows = seed.markets.map((market) => ({
        ...market,
        odds: seed.odds.filter((odds) => odds.marketId === market.id),
      }));
      if (filter.eventId !== undefined) {
        rows = rows.filter((market) => market.eventId === filter.eventId);
      }
      if (filter.family !== undefined) {
        rows = rows.filter((market) => market.family === filter.family);
      }
      if (filter.period !== undefined) {
        rows = rows.filter((market) => market.period === filter.period);
      }
      rows.sort((a, b) => a.id.localeCompare(b.id));
      return pageById(rows, filter.cursor, filter.limit);
    },
    async getMarket(id: string): Promise<MarketView | null> {
      const market = seed.markets.find((market) => market.id === id);
      if (market === undefined) return null;
      return { ...market, odds: seed.odds.filter((odds) => odds.marketId === market.id) };
    },
    async listOdds(filter: OddsFilter): Promise<Page<OddsView>> {
      const rows = seed.odds.filter((odds) => {
        if (filter.marketId !== undefined && odds.marketId !== filter.marketId) return false;
        if (filter.bookmaker !== undefined && odds.bookmaker !== filter.bookmaker) return false;
        if (filter.eventId !== undefined) {
          const market = seed.markets.find((market) => market.id === odds.marketId);
          if (market === undefined || market.eventId !== filter.eventId) return false;
        }
        return true;
      });
      rows.sort((a, b) => a.id.localeCompare(b.id));
      return pageById(rows, filter.cursor, filter.limit);
    },
    async listOpportunities(filter: OpportunityFilter): Promise<Page<OpportunityView>> {
      let rows = [...seed.opportunities];
      if (filter.status !== undefined) {
        rows = rows.filter((opp) => opp.status === filter.status);
      }
      if (filter.eventId !== undefined) {
        rows = rows.filter((opp) => opp.event.id === filter.eventId);
      }
      rows.sort((a, b) => a.id.localeCompare(b.id));
      return pageById(rows, filter.cursor, filter.limit);
    },
    async getOpportunity(id: string): Promise<OpportunityView | null> {
      return seed.opportunities.find((opp) => opp.id === id) ?? null;
    },
    async listProviders(): Promise<ProviderView[]> {
      return [...seed.providers];
    },
    async listScannerRuns(limit: number): Promise<ScannerRunView[]> {
      return limit > 0 ? seed.scannerRuns.slice(0, limit) : [];
    },
    async listAdminSources(): Promise<AdminSourceView[]> {
      return [...seed.adminSources];
    },
    async listAuditLogs() {
      return { data: [], nextCursor: null };
    },
  };
}

export const demoOpportunityIds = buildDemoSeed(Date.now()).opportunities.map((opp) => opp.id);
