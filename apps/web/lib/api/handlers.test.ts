import { describe, expect, it } from "vitest";
import {
  decodeCursor,
  encodeCursor,
  type AdminSourceView,
  type ApiRepo,
  type AuditLogFilter,
  type AuditLogView,
  type Cursor,
  type EpisodeReconstruction,
  type EventFilter,
  type EventView,
  type FalsePositiveReport,
  type HistoryRepo,
  type MarketFilter,
  type MarketView,
  type OddsFilter,
  type OddsHistoryPoint,
  type OddsView,
  type OpportunityEpisodeSummary,
  type OpportunityFilter,
  type OpportunityView,
  type Page,
  type ProviderView,
  type ScannerRunView,
  type SourceLatencyStat,
} from "@22void/db";
import { listAdminSources, listAuditLogs } from "./handlers/admin.js";
import { listEvents, getEvent } from "./handlers/events.js";
import { listMarkets, getMarket, listOdds } from "./handlers/markets.js";
import { listOpportunities, getOpportunity } from "./handlers/opportunities.js";
import { listProviders, scannerStatus, health } from "./handlers/system.js";
import {
  falsePositiveAnalysis,
  getEpisodeReconstruction,
  listEpisodes,
  listOddsHistory,
  sourceLatency,
  type HistoryHandlerDeps,
} from "./handlers/history.js";
import type { HandlerDeps } from "./handlers/common.js";
import { openApiDocument } from "./openapi.js";

const READER_KEY = "reader-secret";
const ADMIN_KEY = "admin-secret";
const env = { apiKey: READER_KEY, adminApiKey: ADMIN_KEY };

function get(url: string, key?: string): Request {
  return new Request(url, {
    headers: key ? { "x-api-key": key } : undefined,
  });
}

async function body(response: Response): Promise<unknown> {
  return (await response.json()) as unknown;
}

function eventView(overrides: Partial<EventView> = {}): EventView {
  return {
    id: "evt_1",
    canonicalEventId: "canon-evt-1",
    sport: "football",
    competition: "UEFA Champions League",
    homeTeam: "Team A",
    awayTeam: "Team B",
    startTime: "2026-10-01T19:00:00.000Z",
    status: "SCHEDULED",
    sourceLinks: [{ sourceKey: "pinnacle", sourceEventId: "src_1" }],
    ...overrides,
  };
}

function oddView(overrides: Partial<OddsView> = {}): OddsView {
  return {
    id: "sel_1",
    marketId: "mkt_1",
    bookmaker: "Pinnacle",
    outcome: "HOME",
    odds: 2.1,
    sourceUpdatedAt: "2026-10-01T18:00:00.000Z",
    observedAt: "2026-10-01T18:00:00.000Z",
    ...overrides,
  };
}

function marketView(overrides: Partial<MarketView> = {}): MarketView {
  return {
    id: "mkt_1",
    eventId: "evt_1",
    sourceKey: "pinnacle",
    sourceMarketId: "pm_1",
    period: "FULL_MATCH",
    family: "MATCH_RESULT",
    marketType: "1X2",
    participant: null,
    line: null,
    status: "OPEN",
    settlementRuleVersion: 1,
    odds: [oddView()],
    ...overrides,
  };
}

function opportunityView(overrides: Partial<OpportunityView> = {}): OpportunityView {
  return {
    id: "opp_1",
    event: {
      id: "evt_1",
      competition: "UEFA Champions League",
      homeTeam: "Team A",
      awayTeam: "Team B",
      startTime: "2026-10-01T19:00:00.000Z",
      status: "SCHEDULED",
    },
    status: "VERIFIED_ARB",
    rejectionReason: null,
    marketStructure: "1X2",
    totalStake: 100,
    minReturn: 102.5,
    guaranteedProfit: 2.5,
    roi: 0.025,
    worstState: null,
    engineVersion: "1.0.0",
    normalizerVersion: "1.0.0",
    settlementVersion: "1.0.0",
    optimizerVersion: "1.0.0",
    detectedAt: "2026-10-01T18:30:00.000Z",
    validatedAt: "2026-10-01T18:30:05.000Z",
    expiresAt: "2026-10-01T18:30:15.000Z",
    legs: [
      {
        id: "oleg_1",
        selectionId: "sel_1",
        bookmaker: "Pinnacle",
        market: {
          family: "MATCH_RESULT",
          marketType: "1X2",
          period: "FULL_MATCH",
          participant: null,
          line: null,
        },
        outcome: "HOME",
        oddsSnapshot: 2.1,
        stake: 48.8,
        guaranteedReturn: 102.5,
        settlementResult: null,
      },
    ],
    ...overrides,
  };
}

function providerView(overrides: Partial<ProviderView> = {}): ProviderView {
  return {
    key: "pinnacle",
    displayName: "Pinnacle",
    baseUrl: "https://pinnacle.example",
    status: "HEALTHY",
    lastSeenAt: "2026-10-01T18:29:00.000Z",
    ...overrides,
  };
}

function scannerRun(overrides: Partial<ScannerRunView> = {}): ScannerRunView {
  return {
    runId: "run_1",
    sourceKey: "pinnacle",
    status: "HEALTHY",
    message: null,
    startedAt: "2026-10-01T18:25:00.000Z",
    finishedAt: "2026-10-01T18:25:02.000Z",
    ...overrides,
  };
}

function auditLogView(overrides: Partial<AuditLogView> = {}): AuditLogView {
  return {
    id: "audit_1",
    opportunityId: "opp_1",
    entityType: "opportunity",
    entityId: "opp_1",
    action: "opportunity.verified",
    actor: "validation@v1",
    detail: { status: "VERIFIED_ARB" },
    createdAt: "2026-10-01T18:30:06.000Z",
    ...overrides,
  };
}

interface FakeCalls {
  eventFilter?: EventFilter;
  marketFilter?: MarketFilter;
  oddsFilter?: OddsFilter;
  opportunityFilter?: OpportunityFilter;
  auditFilter?: AuditLogFilter;
}

function createFakeRepo(calls: FakeCalls): ApiRepo {
  return {
    async listEvents(filter: EventFilter): Promise<Page<EventView>> {
      calls.eventFilter = filter;
      return { data: [eventView()], nextCursor: null };
    },
    async getEvent(id: string): Promise<EventView | null> {
      return id === "evt_1" ? eventView() : null;
    },
    async listMarkets(filter: MarketFilter): Promise<Page<MarketView>> {
      calls.marketFilter = filter;
      return { data: [marketView()], nextCursor: null };
    },
    async getMarket(id: string): Promise<MarketView | null> {
      return id === "mkt_1" ? marketView() : null;
    },
    async listOdds(filter: OddsFilter): Promise<Page<OddsView>> {
      calls.oddsFilter = filter;
      return { data: [oddView()], nextCursor: null };
    },
    async listOpportunities(filter: OpportunityFilter): Promise<Page<OpportunityView>> {
      calls.opportunityFilter = filter;
      if (filter.status === "VERIFIED_ARB") {
        return { data: [opportunityView()], nextCursor: null };
      }
      return { data: [opportunityView({ status: "STALE" })], nextCursor: null };
    },
    async getOpportunity(id: string): Promise<OpportunityView | null> {
      return id === "opp_1" ? opportunityView() : null;
    },
    async listProviders(): Promise<ProviderView[]> {
      return [providerView()];
    },
    async listScannerRuns(limit: number): Promise<ScannerRunView[]> {
      return limit > 0 ? [scannerRun()] : [];
    },
    async listAdminSources(): Promise<AdminSourceView[]> {
      return [
        {
          ...providerView(),
          marketCount: 12,
          rawPayloadCount: 340,
          scannerRunCount: 88,
          settlementRuleCount: 4,
        },
      ];
    },
    async listAuditLogs(filter: AuditLogFilter): Promise<Page<AuditLogView>> {
      calls.auditFilter = filter;
      return { data: [auditLogView()], nextCursor: null };
    },
  };
}

function deps(calls: FakeCalls, overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return { repo: createFakeRepo(calls), env, ...overrides };
}

function episodeSummary(overrides: Partial<OpportunityEpisodeSummary> = {}): OpportunityEpisodeSummary {
  return {
    id: "ep_1",
    eventCanonicalId: "canon-evt-1",
    competition: "UEFA Champions League",
    homeTeam: "Team A",
    awayTeam: "Team B",
    startTime: "2026-10-01T19:00:00.000Z",
    structureType: "1X2",
    marketStructure: "1X2",
    status: "STALE",
    firstSeenAt: "2026-10-01T18:30:00.000Z",
    lastSeenAt: "2026-10-01T18:35:00.000Z",
    detectedCount: 3,
    disappearedAt: "2026-10-01T18:35:20.000Z",
    durationMs: 300000,
    ...overrides,
  };
}

function reconstruction(overrides: Partial<EpisodeReconstruction> = {}): EpisodeReconstruction {
  return {
    episode: episodeSummary(),
    detections: [
      {
        id: "opp_1",
        status: "STALE",
        rejectionReason: null,
        marketStructure: "1X2",
        detectedAt: "2026-10-01T18:30:00.000Z",
        validatedAt: null,
        totalStake: 100,
        guaranteedProfit: 2.5,
        roi: 0.025,
        legs: [{ selectionId: "sel_1", oddsSnapshot: 2.1, stake: 48.8, guaranteedReturn: 102.5 }],
      },
    ],
    legs: [
      {
        selectionId: "sel_1",
        bookmaker: "Pinnacle",
        outcome: "HOME",
        market: {
          family: "MATCH_RESULT",
          marketType: "1X2",
          period: "FULL_MATCH",
          participant: null,
          line: null,
        },
        snapshotOdds: 2.1,
        history: [oddsHistoryPoint()],
        movement: { first: 2.1, last: 2.05, min: 2.05, max: 2.1, delta: -0.05, pctChange: -0.0238 },
      },
    ],
    ...overrides,
  };
}

function oddsHistoryPoint(overrides: Partial<OddsHistoryPoint> = {}): OddsHistoryPoint {
  return {
    selectionId: "sel_1",
    eventCanonicalId: "canon-evt-1",
    family: "MATCH_RESULT",
    marketType: "1X2",
    period: "FULL_MATCH",
    participant: null,
    line: null,
    outcome: "HOME",
    bookmaker: "Pinnacle",
    odds: 2.1,
    observedAt: "2026-10-01T18:30:00.000Z",
    ...overrides,
  };
}

function latencyStat(overrides: Partial<SourceLatencyStat> = {}): SourceLatencyStat {
  return {
    sourceKey: "pinnacle",
    runs: 300,
    avgMs: 145,
    minMs: 60,
    maxMs: 480,
    lastRunAt: "2026-10-01T18:29:00.000Z",
    lastLatencyMs: 120,
    ...overrides,
  };
}

function falsePositiveReport(overrides: Partial<FalsePositiveReport> = {}): FalsePositiveReport {
  return {
    episodes: 10,
    active: 4,
    concluded: 6,
    verified: 4,
    falsePositives: 2,
    falsePositiveRate: 0.3333,
    byStatus: [{ status: "STALE", count: 1, avgDurationMs: 420000 }],
    topRejectionReasons: [{ reason: "odds_moved", count: 2 }],
    ...overrides,
  };
}

interface FakeHistoryCalls {
  episodeFilter?: unknown;
  oddsFilter?: unknown;
  latencyFilter?: unknown;
  analysisFilter?: unknown;
  requestedEpisodeId?: string | null;
}

function createFakeHistoryRepo(calls: FakeHistoryCalls, episodes: OpportunityEpisodeSummary[] = [episodeSummary()]): HistoryRepo {
  return {
    async listEpisodes(filter) {
      calls.episodeFilter = filter;
      return episodes;
    },
    async getEpisodeReconstruction(id) {
      calls.requestedEpisodeId = id;
      return id === "ep_1" ? reconstruction() : null;
    },
    async listOddsHistory(filter) {
      calls.oddsFilter = filter;
      return [oddsHistoryPoint()];
    },
    async sourceLatency(filter) {
      calls.latencyFilter = filter;
      return [latencyStat()];
    },
    async falsePositiveAnalysis(filter) {
      calls.analysisFilter = filter;
      return falsePositiveReport();
    },
  };
}

function historyDeps(
  calls: FakeHistoryCalls,
  overrides: Partial<HistoryHandlerDeps> = {},
): HistoryHandlerDeps {
  return { repo: createFakeHistoryRepo(calls), env, ...overrides };
}

describe("GET /api/v1/events", () => {
  it("requires an API key and answers 401 without one", async () => {
    const response = await listEvents(get("http://test.local/api/v1/events"), deps({}));
    expect(response.status).toBe(401);
    expect(await body(response)).toMatchObject({ error: { code: "UNAUTHORIZED" } });
  });

  it("rejects an unknown key", async () => {
    const response = await listEvents(get("http://test.local/api/v1/events", "nope"), deps({}));
    expect(response.status).toBe(401);
  });

  it("lists events with pagination for a valid reader key", async () => {
    const calls: FakeCalls = {};
    const response = await listEvents(
      get("http://test.local/api/v1/events?limit=5", READER_KEY),
      deps(calls),
    );
    expect(response.status).toBe(200);
    const payload = (await body(response)) as {
      data: EventView[];
      pagination: { limit: number; nextCursor: null };
    };
    expect(payload.data[0]?.homeTeam).toBe("Team A");
    expect(payload.pagination).toEqual({ limit: 5, nextCursor: null });
  });

  it("passes filters through to the repository", async () => {
    const calls: FakeCalls = {};
    await listEvents(
      get("http://test.local/api/v1/events?status=LIVE&competition=UCL&team=Team", READER_KEY),
      deps(calls),
    );
    expect(calls.eventFilter).toMatchObject({
      status: "LIVE",
      competition: "UCL",
      team: "Team",
      limit: 50,
      cursor: null,
    });
  });

  it("parses ISO start bounds", async () => {
    const calls: FakeCalls = {};
    await listEvents(
      get(
        "http://test.local/api/v1/events?startFrom=2026-10-01T00:00:00.000Z&startTo=2026-11-01T00:00:00.000Z",
        READER_KEY,
      ),
      deps(calls),
    );
    expect(calls.eventFilter?.startFrom).toBe("2026-10-01T00:00:00.000Z");
    expect(calls.eventFilter?.startTo).toBe("2026-11-01T00:00:00.000Z");
  });

  it("decodes an opaque cursor and forwards it", async () => {
    const calls: FakeCalls = {};
    const cursor: Cursor = { value: "2026-10-01T19:00:00.000Z", direction: 1, id: "evt_1" };
    await listEvents(
      get(`http://test.local/api/v1/events?cursor=${encodeCursor(cursor)}`, READER_KEY),
      deps(calls),
    );
    expect(calls.eventFilter?.cursor).toEqual(cursor);
  });

  it("rejects a malformed cursor with 400", async () => {
    const response = await listEvents(
      get("http://test.local/api/v1/events?cursor=not-a-cursor", READER_KEY),
      deps({}),
    );
    expect(response.status).toBe(400);
    expect(await body(response)).toMatchObject({ error: { code: "BAD_REQUEST" } });
  });

  it("rejects invalid query parameters with 400", async () => {
    const response = await listEvents(
      get("http://test.local/api/v1/events?limit=not-a-number", READER_KEY),
      deps({}),
    );
    expect(response.status).toBe(400);
    expect(await body(response)).toMatchObject({ error: { code: "BAD_REQUEST" } });
  });

  it("rejects an unknown event status value", async () => {
    const response = await listEvents(
      get("http://test.local/api/v1/events?status=NOT_A_STATUS", READER_KEY),
      deps({}),
    );
    expect(response.status).toBe(400);
  });
});

describe("GET /api/v1/events/:id", () => {
  it("returns an event detail", async () => {
    const response = await getEvent(
      get("http://test.local/api/v1/events/evt_1", READER_KEY),
      deps({}),
      "evt_1",
    );
    expect(response.status).toBe(200);
    const payload = (await body(response)) as { data: EventView };
    expect(payload.data.sourceLinks[0]).toEqual({
      sourceKey: "pinnacle",
      sourceEventId: "src_1",
    });
  });

  it("answers 404 for an unknown event", async () => {
    const response = await getEvent(
      get("http://test.local/api/v1/events/missing", READER_KEY),
      deps({}),
      "missing",
    );
    expect(response.status).toBe(404);
    expect(await body(response)).toMatchObject({ error: { code: "NOT_FOUND" } });
  });
});

describe("markets and odds", () => {
  it("lists markets and forwards an eventId filter", async () => {
    const calls: FakeCalls = {};
    const response = await listMarkets(
      get("http://test.local/api/v1/markets?eventId=evt_1&family=MATCH_RESULT&period=FULL_MATCH", READER_KEY),
      deps(calls),
    );
    expect(response.status).toBe(200);
    expect(calls.marketFilter).toMatchObject({ eventId: "evt_1", family: "MATCH_RESULT" });
  });

  it("returns market detail with current odds", async () => {
    const response = await getMarket(
      get("http://test.local/api/v1/markets/mkt_1", READER_KEY),
      deps({}),
      "mkt_1",
    );
    expect(response.status).toBe(200);
    const payload = (await body(response)) as { data: MarketView };
    expect(payload.data.odds[0]).toMatchObject({ bookmaker: "Pinnacle", odds: 2.1 });
  });

  it("answers 404 for an unknown market", async () => {
    const response = await getMarket(
      get("http://test.local/api/v1/markets/nope", READER_KEY),
      deps({}),
      "nope",
    );
    expect(response.status).toBe(404);
  });

  it("lists odds and forwards a bookmaker filter", async () => {
    const calls: FakeCalls = {};
    const response = await listOdds(
      get("http://test.local/api/v1/odds?bookmaker=Pinnacle&marketId=mkt_1", READER_KEY),
      deps(calls),
    );
    expect(response.status).toBe(200);
    expect(calls.oddsFilter).toMatchObject({ bookmaker: "Pinnacle", marketId: "mkt_1" });
  });
});

describe("opportunities", () => {
  it("filters by lifecycle status", async () => {
    const calls: FakeCalls = {};
    const response = await listOpportunities(
      get("http://test.local/api/v1/opportunities?status=VERIFIED_ARB", READER_KEY),
      deps(calls),
    );
    expect(response.status).toBe(200);
    const payload = (await body(response)) as { data: OpportunityView[] };
    expect(payload.data[0]?.status).toBe("VERIFIED_ARB");
  });

  it("returns opportunity detail with legs and validation evidence", async () => {
    const response = await getOpportunity(
      get("http://test.local/api/v1/opportunities/opp_1", READER_KEY),
      deps({}),
      "opp_1",
    );
    expect(response.status).toBe(200);
    const payload = (await body(response)) as { data: OpportunityView };
    expect(payload.data.legs[0]?.oddsSnapshot).toBe(2.1);
    expect(payload.data.validatedAt).toBe("2026-10-01T18:30:05.000Z");
    expect(payload.data.status).toBe("VERIFIED_ARB");
  });

  it("answers 404 for an unknown opportunity", async () => {
    const response = await getOpportunity(
      get("http://test.local/api/v1/opportunities/missing", READER_KEY),
      deps({}),
      "missing",
    );
    expect(response.status).toBe(404);
  });
});

describe("system endpoints", () => {
  it("serves health without an API key", async () => {
    const response = await health();
    expect(response.status).toBe(200);
    const payload = (await body(response)) as { status: string; service: string };
    expect(payload.status).toBe("ok");
    expect(payload.service).toBe("@22void/web");
  });

  it("requires an API key for providers", async () => {
    const response = await listProviders(get("http://test.local/api/v1/providers"), deps({}));
    expect(response.status).toBe(401);
  });

  it("lists providers with the reader key", async () => {
    const response = await listProviders(
      get("http://test.local/api/v1/providers", READER_KEY),
      deps({}),
    );
    expect(response.status).toBe(200);
    const payload = (await body(response)) as { data: ProviderView[] };
    expect(payload.data[0]).toMatchObject({ key: "pinnacle", status: "HEALTHY" });
  });

  it("reports a stale scanner run against a frozen clock", async () => {
    const now = Date.parse("2026-10-01T20:00:00.000Z");
    const staleRun = scannerRun({
      startedAt: "2026-10-01T19:40:00.000Z",
      finishedAt: "2026-10-01T19:40:01.000Z",
    });
    const response = await scannerStatus(get("http://test.local/api/v1/scanner", READER_KEY), {
      repo: {
        ...createFakeRepo({}),
        listScannerRuns: async () => [staleRun],
      },
      env,
      now: () => now,
    });
    expect(response.status).toBe(200);
    const payload = (await body(response)) as {
      overall: { status: string; stale: unknown; lastRunAt: string | null; runningRuns: number };
    };
    expect(payload.overall.status).toBe("HEALTHY");
    expect(payload.overall.stale).toEqual({
      sourceKey: "pinnacle",
      since: "2026-10-01T19:40:00.000Z",
    });
  });
});

describe("admin endpoints", () => {
  it("forbids the reader key with 403", async () => {
    const response = await listAdminSources(
      get("http://test.local/api/v1/admin/sources", READER_KEY),
      deps({}),
    );
    expect(response.status).toBe(403);
    expect(await body(response)).toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("allows the admin key and returns source counts", async () => {
    const response = await listAdminSources(
      get("http://test.local/api/v1/admin/sources", ADMIN_KEY),
      deps({}),
    );
    expect(response.status).toBe(200);
    const payload = (await body(response)) as { data: AdminSourceView[] };
    expect(payload.data[0]).toMatchObject({ marketCount: 12, scannerRunCount: 88 });
  });

  it("lists audit logs with the admin key and forwards entityType filter", async () => {
    const calls: FakeCalls = {};
    const response = await listAuditLogs(
      get("http://test.local/api/v1/admin/audit-logs?entityType=opportunity", ADMIN_KEY),
      deps(calls),
    );
    expect(response.status).toBe(200);
    expect(calls.auditFilter).toMatchObject({ entityType: "opportunity", limit: 50 });
  });

  it("forbids audit logs for the reader key", async () => {
    const response = await listAuditLogs(
      get("http://test.local/api/v1/admin/audit-logs", READER_KEY),
      deps({}),
    );
    expect(response.status).toBe(403);
  });
});

describe("history endpoints", () => {
  it("requires an API key", async () => {
    const response = await listEpisodes(get("http://test.local/api/v1/history/opportunities"), {
      ...historyDeps({}),
    });
    expect(response.status).toBe(401);
    expect(await body(response)).toMatchObject({ error: { code: "UNAUTHORIZED" } });
  });

  it("lists episodes and forwards eventId and status filters", async () => {
    const calls: FakeHistoryCalls = {};
    const response = await listEpisodes(
      get(
        "http://test.local/api/v1/history/opportunities?eventId=canon-evt-1&status=STALE&limit=5",
        READER_KEY,
      ),
      historyDeps(calls),
    );
    expect(response.status).toBe(200);
    const payload = (await body(response)) as { data: OpportunityEpisodeSummary[] };
    expect(payload.data[0]).toMatchObject({ id: "ep_1", durationMs: 300000 });
    expect(calls.episodeFilter).toMatchObject({
      eventCanonicalId: "canon-evt-1",
      status: "STALE",
      limit: 5,
    });
  });

  it("defaults the episode list limit to 50", async () => {
    const calls: FakeHistoryCalls = {};
    await listEpisodes(get("http://test.local/api/v1/history/opportunities", READER_KEY), historyDeps(calls));
    expect(calls.episodeFilter).toMatchObject({ limit: 50 });
  });

  it("returns a full reconstruction for a known episode", async () => {
    const response = await getEpisodeReconstruction(
      get("http://test.local/api/v1/history/opportunities/ep_1", READER_KEY),
      historyDeps({}),
      "ep_1",
    );
    expect(response.status).toBe(200);
    const payload = (await body(response)) as { data: EpisodeReconstruction };
    expect(payload.data.episode.id).toBe("ep_1");
    expect(payload.data.legs[0]?.history[0]?.odds).toBe(2.1);
    expect(payload.data.legs[0]?.movement.delta).toBe(-0.05);
  });

  it("answers 404 for an unknown episode", async () => {
    const response = await getEpisodeReconstruction(
      get("http://test.local/api/v1/history/opportunities/nope", READER_KEY),
      historyDeps({}),
      "nope",
    );
    expect(response.status).toBe(404);
  });

  it("rejects a malformed episode id with 400", async () => {
    const response = await getEpisodeReconstruction(
      get("http://test.local/api/v1/history/opportunities/x", READER_KEY),
      historyDeps({}),
      "x".repeat(65),
    );
    expect(response.status).toBe(400);
  });

  it("requires selectionId or eventId for odds history", async () => {
    const response = await listOddsHistory(
      get("http://test.local/api/v1/history/odds", READER_KEY),
      historyDeps({}),
    );
    expect(response.status).toBe(400);
    expect(await body(response)).toMatchObject({ error: { code: "BAD_REQUEST" } });
  });

  it("returns the odds series for a selection and forwards bounds", async () => {
    const calls: FakeHistoryCalls = {};
    const response = await listOddsHistory(
      get(
        "http://test.local/api/v1/history/odds?selectionId=sel_1&from=2026-10-01T18:00:00.000Z&to=2026-10-01T19:00:00.000Z",
        READER_KEY,
      ),
      historyDeps(calls),
    );
    expect(response.status).toBe(200);
    const payload = (await body(response)) as { data: OddsHistoryPoint[] };
    expect(payload.data[0]?.bookmaker).toBe("Pinnacle");
    expect(calls.oddsFilter).toMatchObject({
      selectionId: "sel_1",
      from: "2026-10-01T18:00:00.000Z",
      to: "2026-10-01T19:00:00.000Z",
      limit: 50,
    });
  });

  it("supports the event-wide odds series via eventId", async () => {
    const calls: FakeHistoryCalls = {};
    const response = await listOddsHistory(
      get("http://test.local/api/v1/history/odds?eventId=canon-evt-1", READER_KEY),
      historyDeps(calls),
    );
    expect(response.status).toBe(200);
    expect(calls.oddsFilter).toMatchObject({ eventCanonicalId: "canon-evt-1" });
  });

  it("returns source latency statistics", async () => {
    const calls: FakeHistoryCalls = {};
    const response = await sourceLatency(
      get("http://test.local/api/v1/history/latency?sourceKey=pinnacle", READER_KEY),
      historyDeps(calls),
    );
    expect(response.status).toBe(200);
    const payload = (await body(response)) as { data: SourceLatencyStat[] };
    expect(payload.data[0]).toMatchObject({ sourceKey: "pinnacle", avgMs: 145 });
    expect(calls.latencyFilter).toMatchObject({ sourceKey: "pinnacle" });
  });

  it("returns the false-positive report", async () => {
    const calls: FakeHistoryCalls = {};
    const response = await falsePositiveAnalysis(
      get("http://test.local/api/v1/history/analysis?after=2026-10-01T00:00:00.000Z", READER_KEY),
      historyDeps(calls),
    );
    expect(response.status).toBe(200);
    const payload = (await body(response)) as { data: FalsePositiveReport };
    expect(payload.data).toMatchObject({ episodes: 10, falsePositiveRate: 0.3333 });
    expect(calls.analysisFilter).toMatchObject({ after: "2026-10-01T00:00:00.000Z" });
  });
});

describe("cursor codec integration", () => {
  it("round-trips a cursor through encode and decode", () => {
    const cursor: Cursor = { value: "2026-10-01T19:00:00.000Z", direction: -1, id: "opp_1" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("emits a nextCursor from the repository boundary", async () => {
    const next: Cursor = { value: "2026-10-01T19:00:00.000Z", direction: 1, id: "evt_1" };
    const response = await listEvents(get("http://test.local/api/v1/events?limit=1", READER_KEY), {
      repo: {
        ...createFakeRepo({}),
        listEvents: async (): Promise<Page<EventView>> => ({
          data: [eventView()],
          nextCursor: next,
        }),
      },
      env,
    });
    const payload = (await body(response)) as { pagination: { nextCursor: string } };
    expect(decodeCursor(payload.pagination.nextCursor)).toEqual(next);
  });
});

describe("openapi contract", () => {
  it("is a 3.0.3 document covering every endpoint group", () => {
    expect(openApiDocument.openapi).toBe("3.0.3");
    expect(Object.keys(openApiDocument.paths)).toEqual(
      expect.arrayContaining([
        "/health",
        "/openapi",
        "/events",
        "/events/{id}",
        "/markets",
        "/markets/{id}",
        "/odds",
        "/opportunities",
        "/opportunities/{id}",
        "/providers",
        "/scanner",
        "/admin/sources",
        "/admin/audit-logs",
        "/history/opportunities",
        "/history/opportunities/{id}",
        "/history/odds",
        "/history/latency",
        "/history/analysis",
      ]),
    );
  });

  it("documents the apiKey security scheme", () => {
    const scheme = (openApiDocument.components.securitySchemes as {
      apiKey: { type: string; in: string; name: string };
    }).apiKey;
    expect(scheme).toMatchObject({ type: "apiKey", in: "header", name: "x-api-key" });
  });

  it("advertises the Phase 11 verified status", () => {
    const schemas = openApiDocument.components.schemas as Record<
      string,
      { enum?: string[] }
    >;
    const status = schemas.OpportunityStatus?.enum ?? [];
    expect(status).toContain("VERIFIED_ARB");
    expect(status).toContain("THEORETICAL_ARB");
    expect(status).toContain("REJECTED");
  });
});