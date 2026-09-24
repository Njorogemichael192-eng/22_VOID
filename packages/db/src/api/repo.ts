/**
 * @22void/db — Prisma-backed API repository (Phase 12).
 *
 * Maps Prisma rows to the JSON-safe views in ./types.ts. Keyset pagination uses
 * opaque cursors (./cursor.ts); every list method fetches `limit + 1` rows to
 * learn whether another page exists.
 */

import type {
  Bookmaker,
  Event,
  Market,
  OddsSource,
  Opportunity,
  OpportunityLeg,
  Prisma,
  PrismaClient,
  ScannerHealth,
  Selection,
  SettlementRule,
  SourceEventId,
} from "../generated/client/client";
import { getPrismaClient } from "../client";
import {
  falsePositiveAnalysis,
  getEpisodeReconstruction,
  listOpportunityEpisodes,
  loadOddsHistory,
  sourceLatencyStats,
} from "../history";
import type { Cursor } from "./cursor";
import type {
  AdminSourceView,
  ApiRepo,
  AuditLogFilter,
  AuditLogView,
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
} from "./types";
import type {
  EpisodeHistoryFilter,
  FalsePositiveFilter,
  HistoryRepo,
  OddsHistoryFilterView,
  SourceLatencyFilter,
} from "./types";

type EventWithSources = Event & {
  sourceEventIds: Array<SourceEventId & { oddsSource: OddsSource }>;
};

type SelectionRow = Selection & { bookmaker: Bookmaker };

type MarketWithSelections = Market & {
  oddsSource: OddsSource;
  settlementRule: SettlementRule;
  selections: SelectionRow[];
};

type LegWithSelection = OpportunityLeg & {
  selection: Selection & { bookmaker: Bookmaker; market: Market };
};

type OpportunityWithLegs = Opportunity & {
  event: Event;
  legs: LegWithSelection[];
};

type ScannerRow = ScannerHealth & { oddsSource: { key: string } | null };

const ASC = 1 as const;
const DESC = -1 as const;

function isoOf(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function numOf(
  value: { toNumber?(): number } | string | number | null | undefined,
): number | null {
  return value == null ? null : Number(value);
}

function orderDir(direction: 1 | -1): "asc" | "desc" {
  return direction === DESC ? "desc" : "asc";
}

/**
 * Slice a `limit + 1` result set into a page and, when there are more rows, a
 * cursor pointing at the boundary row. `direction` is the ordering used for the
 * query, so the emitted cursor keeps the same continuation semantics.
 */
function takePage<T>(
  rows: T[],
  limit: number,
  direction: 1 | -1,
  boundary: (last: T, direction: 1 | -1) => Cursor,
): Page<T> {
  if (rows.length === 0) {
    return { data: [], nextCursor: null };
  }
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];
  return {
    data,
    nextCursor: hasMore && last ? boundary(last, direction) : null,
  };
}

function byIdCursor(last: { id: string }, direction: 1 | -1): Cursor {
  return { value: last.id, direction, id: last.id };
}

/**
 * Append the keyset continuation for an id-ordered list. Works on any Prisma
 * where-input that has an optional `id` member.
 */
function applyIdCursor(conditions: Array<{ id?: unknown }>, cursor: Cursor | null): void {
  if (!cursor) return;
  if (cursor.direction === ASC) {
    conditions.push({ id: { gt: cursor.id } });
  } else {
    conditions.push({ id: { lt: cursor.id } });
  }
}

function buildEventWhere(filter: EventFilter): Prisma.EventWhereInput {
  const conditions: Prisma.EventWhereInput[] = [];
  if (filter.status) {
    conditions.push({ status: filter.status as Event["status"] });
  }
  if (filter.competition) {
    conditions.push({ competition: { contains: filter.competition, mode: "insensitive" } });
  }
  if (filter.team) {
    conditions.push({
      OR: [
        { homeTeam: { contains: filter.team, mode: "insensitive" } },
        { awayTeam: { contains: filter.team, mode: "insensitive" } },
      ],
    });
  }
  if (filter.startFrom || filter.startTo) {
    conditions.push({
      startTime: {
        ...(filter.startFrom ? { gte: new Date(filter.startFrom) } : {}),
        ...(filter.startTo ? { lte: new Date(filter.startTo) } : {}),
      },
    });
  }
  if (filter.cursor) {
    const boundary = new Date(filter.cursor.value);
    if (filter.cursor.direction === ASC) {
      conditions.push({
        OR: [
          { startTime: { gt: boundary } },
          { startTime: boundary, id: { gt: filter.cursor.id } },
        ],
      });
    } else {
      conditions.push({
        OR: [
          { startTime: { lt: boundary } },
          { startTime: boundary, id: { lt: filter.cursor.id } },
        ],
      });
    }
  }
  return conditions.length ? { AND: conditions } : {};
}

interface OrWhereInput {
  OR?: unknown;
  detectedAt?: unknown;
  id?: unknown;
  eventId?: unknown;
  status?: unknown;
}

function buildDateTimeWhere(conditions: OrWhereInput[], cursor: Cursor | null): void {
  if (!cursor) return;
  const boundary = new Date(cursor.value);
  const cmp = cursor.direction === DESC ? "lt" : "gt";
  conditions.push({
    OR: [
      { detectedAt: { [cmp]: boundary } },
      { detectedAt: boundary, id: { [cmp]: cursor.id } },
    ],
  });
}

function mapEvent(row: EventWithSources): EventView {
  return {
    id: row.id,
    canonicalEventId: row.canonicalEventId,
    sport: row.sport,
    competition: row.competition,
    homeTeam: row.homeTeam,
    awayTeam: row.awayTeam,
    startTime: row.startTime.toISOString(),
    status: row.status,
    sourceLinks: row.sourceEventIds.map((link) => ({
      sourceKey: link.oddsSource.key,
      sourceEventId: link.sourceEventId,
    })),
  };
}

function mapMarket(row: MarketWithSelections): MarketView {
  return {
    id: row.id,
    eventId: row.eventId,
    sourceKey: row.oddsSource.key,
    sourceMarketId: row.sourceMarketId,
    period: row.period,
    family: row.family,
    marketType: row.marketType,
    participant: row.participant,
    line: row.line,
    status: row.status,
    settlementRuleVersion: row.settlementRule.version,
    odds: row.selections.map(mapSelection),
  };
}

function mapSelection(row: SelectionRow): OddsView {
  return {
    id: row.id,
    marketId: row.marketId,
    bookmaker: row.bookmaker.name,
    outcome: row.outcome,
    odds: Number(row.odds),
    sourceUpdatedAt: isoOf(row.sourceUpdatedAt),
    observedAt: row.observedAt.toISOString(),
  };
}

function mapOpportunity(row: OpportunityWithLegs): OpportunityView {
  return {
    id: row.id,
    event: {
      id: row.event.id,
      competition: row.event.competition,
      homeTeam: row.event.homeTeam,
      awayTeam: row.event.awayTeam,
      startTime: row.event.startTime.toISOString(),
      status: row.event.status,
    },
    status: row.status,
    rejectionReason: row.rejectionReason,
    marketStructure: row.marketStructure,
    totalStake: numOf(row.totalStake),
    minReturn: numOf(row.minReturn),
    guaranteedProfit: numOf(row.guaranteedProfit),
    roi: numOf(row.roi),
    worstState: row.worstState,
    engineVersion: row.engineVersion,
    normalizerVersion: row.normalizerVersion,
    settlementVersion: row.settlementVersion,
    optimizerVersion: row.optimizerVersion,
    detectedAt: row.detectedAt.toISOString(),
    validatedAt: isoOf(row.validatedAt),
    expiresAt: isoOf(row.expiresAt),
    legs: row.legs.map((leg) => ({
      id: leg.id,
      selectionId: leg.selectionId,
      bookmaker: leg.selection.bookmaker.name,
      market: {
        family: leg.selection.market.family,
        marketType: leg.selection.market.marketType,
        period: leg.selection.market.period,
        participant: leg.selection.market.participant,
        line: leg.selection.market.line,
      },
      outcome: leg.selection.outcome,
      oddsSnapshot: Number(leg.oddsSnapshot),
      stake: numOf(leg.stake),
      guaranteedReturn: numOf(leg.guaranteedReturn),
      settlementResult: leg.settlementResult,
    })),
  };
}

function mapProvider(row: OddsSource): ProviderView {
  return {
    key: row.key,
    displayName: row.displayName,
    baseUrl: row.baseUrl,
    status: row.status,
    lastSeenAt: isoOf(row.lastSeenAt),
  };
}

function mapScannerRun(row: ScannerRow): ScannerRunView {
  return {
    runId: row.runId,
    sourceKey: row.oddsSource?.key ?? null,
    status: row.status,
    message: row.message,
    startedAt: row.startedAt.toISOString(),
    finishedAt: isoOf(row.finishedAt),
  };
}

/**
 * Create the API repository against a Prisma client. Defaults to the shared
 * process-wide client so route handlers and future workers share one pool.
 */
export function createApiRepo(client: PrismaClient = getPrismaClient()): ApiRepo {
  return {
    async listEvents(filter: EventFilter): Promise<Page<EventView>> {
      const direction = filter.cursor ? filter.cursor.direction : ASC;
      const rows = await client.event.findMany({
        where: buildEventWhere(filter),
        orderBy: [{ startTime: orderDir(direction) }, { id: orderDir(direction) }],
        take: filter.limit + 1,
        include: { sourceEventIds: { include: { oddsSource: true } } },
      });
      const page = takePage(rows, filter.limit, direction, (last, d) => ({
        value: last.startTime.toISOString(),
        direction: d,
        id: last.id,
      }));
      return { data: page.data.map(mapEvent), nextCursor: page.nextCursor };
    },

    async getEvent(id: string): Promise<EventView | null> {
      const row = await client.event.findUnique({
        where: { id },
        include: { sourceEventIds: { include: { oddsSource: true } } },
      });
      return row ? mapEvent(row) : null;
    },

    async listMarkets(filter: MarketFilter): Promise<Page<MarketView>> {
      const conditions: Prisma.MarketWhereInput[] = [];
      if (filter.eventId) conditions.push({ eventId: filter.eventId });
      if (filter.family) conditions.push({ family: filter.family as Market["family"] });
      if (filter.period) conditions.push({ period: filter.period as Market["period"] });
      applyIdCursor(conditions, filter.cursor);
      const rows = await client.market.findMany({
        where: conditions.length ? { AND: conditions } : {},
        orderBy: [{ id: "asc" }],
        take: filter.limit + 1,
        include: {
          oddsSource: true,
          settlementRule: true,
          selections: { include: { bookmaker: true } },
        },
      });
      const page = takePage(rows, filter.limit, ASC, byIdCursor);
      return { data: page.data.map(mapMarket), nextCursor: page.nextCursor };
    },

    async getMarket(id: string): Promise<MarketView | null> {
      const row = await client.market.findUnique({
        where: { id },
        include: {
          oddsSource: true,
          settlementRule: true,
          selections: { include: { bookmaker: true } },
        },
      });
      return row ? mapMarket(row) : null;
    },

    async listOdds(filter: OddsFilter): Promise<Page<OddsView>> {
      const conditions: Prisma.SelectionWhereInput[] = [];
      if (filter.marketId) conditions.push({ marketId: filter.marketId });
      if (filter.eventId) conditions.push({ market: { eventId: filter.eventId } });
      if (filter.bookmaker) {
        conditions.push({
          bookmaker: { name: { contains: filter.bookmaker, mode: "insensitive" } },
        });
      }
      applyIdCursor(conditions, filter.cursor);
      const rows = await client.selection.findMany({
        where: conditions.length ? { AND: conditions } : {},
        orderBy: [{ id: "asc" }],
        take: filter.limit + 1,
        include: { bookmaker: true },
      });
      const page = takePage(rows, filter.limit, ASC, byIdCursor);
      return { data: page.data.map(mapSelection), nextCursor: page.nextCursor };
    },

    async listOpportunities(filter: OpportunityFilter): Promise<Page<OpportunityView>> {
      const direction = filter.cursor ? filter.cursor.direction : DESC;
      const conditions: Prisma.OpportunityWhereInput[] = [];
      if (filter.status) {
        conditions.push({ status: filter.status as Opportunity["status"] });
      }
      if (filter.eventId) conditions.push({ eventId: filter.eventId });
      buildDateTimeWhere(conditions, filter.cursor);
      const rows = await client.opportunity.findMany({
        where: conditions.length ? { AND: conditions } : {},
        orderBy: [{ detectedAt: orderDir(direction) }, { id: orderDir(direction) }],
        take: filter.limit + 1,
        include: {
          event: true,
          legs: {
            include: { selection: { include: { bookmaker: true, market: true } } },
          },
        },
      });
      const page = takePage(rows, filter.limit, direction, (last, d) => ({
        value: last.detectedAt.toISOString(),
        direction: d,
        id: last.id,
      }));
      return { data: page.data.map(mapOpportunity), nextCursor: page.nextCursor };
    },

    async getOpportunity(id: string): Promise<OpportunityView | null> {
      const row = await client.opportunity.findUnique({
        where: { id },
        include: {
          event: true,
          legs: {
            include: { selection: { include: { bookmaker: true, market: true } } },
          },
        },
      });
      return row ? mapOpportunity(row) : null;
    },

    async listProviders(): Promise<ProviderView[]> {
      const rows = await client.oddsSource.findMany({ orderBy: { key: "asc" } });
      return rows.map(mapProvider);
    },

    async listScannerRuns(limit: number): Promise<ScannerRunView[]> {
      const rows = await client.scannerHealth.findMany({
        orderBy: { startedAt: "desc" },
        take: limit,
        include: { oddsSource: { select: { key: true } } },
      });
      return rows.map(mapScannerRun);
    },

    async listAdminSources(): Promise<AdminSourceView[]> {
      const rows = await client.oddsSource.findMany({
        orderBy: { key: "asc" },
        include: {
          _count: {
            select: {
              markets: true,
              rawPayloads: true,
              scannerChecks: true,
              settlementRules: true,
            },
          },
        },
      });
      return rows.map((row) => ({
        ...mapProvider(row),
        marketCount: row._count.markets,
        rawPayloadCount: row._count.rawPayloads,
        scannerRunCount: row._count.scannerChecks,
        settlementRuleCount: row._count.settlementRules,
      }));
    },

    async listAuditLogs(filter: AuditLogFilter): Promise<Page<AuditLogView>> {
      const conditions: Prisma.AuditLogWhereInput[] = [];
      if (filter.entityType) conditions.push({ entityType: filter.entityType });
      applyIdCursor(conditions, filter.cursor);
      const rows = await client.auditLog.findMany({
        where: conditions.length ? { AND: conditions } : {},
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: filter.limit + 1,
      });
      const page = takePage(rows, filter.limit, DESC, byIdCursor);
      return {
        data: page.data.map((row) => ({
          id: row.id,
          opportunityId: row.opportunityId,
          entityType: row.entityType,
          entityId: row.entityId,
          action: row.action,
          actor: row.actor,
          detail: row.detail,
          createdAt: row.createdAt.toISOString(),
        })),
        nextCursor: page.nextCursor,
      };
    },
  };
}

/**
 * History read model (Phase 15): a narrow, read-only repository over the
 * historical reconstruction layer in ./history.ts. The web handlers depend on
 * this interface only, matching the ApiRepo contract pattern.
 */
export function createHistoryRepo(client: PrismaClient = getPrismaClient()): HistoryRepo {
  return {
    async listEpisodes(filter: EpisodeHistoryFilter) {
      return listOpportunityEpisodes(client, {
        ...(filter.eventCanonicalId !== undefined
          ? { eventCanonicalId: filter.eventCanonicalId }
          : {}),
        ...(filter.status !== undefined
          ? { status: filter.status as Opportunity["status"] }
          : {}),
        ...(filter.limit !== undefined ? { limit: filter.limit } : {}),
      });
    },
    async getEpisodeReconstruction(episodeId: string) {
      return getEpisodeReconstruction(client, episodeId);
    },
    async listOddsHistory(filter: OddsHistoryFilterView) {
      return loadOddsHistory(client, {
        ...(filter.selectionId !== undefined ? { selectionId: filter.selectionId } : {}),
        ...(filter.eventCanonicalId !== undefined
          ? { eventCanonicalId: filter.eventCanonicalId }
          : {}),
        ...(filter.from !== undefined ? { from: filter.from } : {}),
        ...(filter.to !== undefined ? { to: filter.to } : {}),
        ...(filter.limit !== undefined ? { limit: filter.limit } : {}),
      });
    },
    async sourceLatency(filter: SourceLatencyFilter) {
      return sourceLatencyStats(client, {
        ...(filter.sourceKey !== undefined ? { sourceKey: filter.sourceKey } : {}),
        ...(filter.after !== undefined ? { after: filter.after } : {}),
        ...(filter.limit !== undefined ? { limit: filter.limit } : {}),
      });
    },
    async falsePositiveAnalysis(filter: FalsePositiveFilter) {
      return falsePositiveAnalysis(client, {
        ...(filter.after !== undefined ? { after: filter.after } : {}),
      });
    },
  };
}