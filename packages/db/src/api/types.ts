/**
 * @22void/db — API read-model contract (Phase 12).
 *
 * JSON-safe DTO views plus the repository interface the HTTP layer consumes.
 * Handlers depend only on this interface; the Prisma implementation lives in
 * ./repo.ts and tests inject an in-memory fake. Keeping the contract here means
 * the web layer never couples to Prisma types (docs/ARCHITECTURE.md).
 */

import type { Cursor } from "./cursor.js";
import type {
  EpisodeReconstruction,
  FalsePositiveReport,
  OddsHistoryPoint,
  OpportunityEpisodeSummary,
  SourceLatencyStat,
} from "../history.js";

/** One page of list results; `nextCursor` is null on the last page. */
export interface Page<T> {
  data: T[];
  nextCursor: Cursor | null;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface EventFilter {
  status?: string;
  competition?: string;
  team?: string;
  startFrom?: string;
  startTo?: string;
  cursor: Cursor | null;
  limit: number;
}

export interface MarketFilter {
  eventId?: string;
  family?: string;
  period?: string;
  cursor: Cursor | null;
  limit: number;
}

export interface OddsFilter {
  eventId?: string;
  marketId?: string;
  bookmaker?: string;
  cursor: Cursor | null;
  limit: number;
}

export interface OpportunityFilter {
  status?: string;
  eventId?: string;
  cursor: Cursor | null;
  limit: number;
}

export interface AuditLogFilter {
  entityType?: string;
  cursor: Cursor | null;
  limit: number;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface EventSourceLinkView {
  sourceKey: string;
  sourceEventId: string;
}

export interface EventView {
  id: string;
  canonicalEventId: string;
  sport: string;
  competition: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  status: string;
  sourceLinks: EventSourceLinkView[];
}

export interface OddsView {
  id: string;
  marketId: string;
  bookmaker: string;
  outcome: string;
  odds: number;
  sourceUpdatedAt: string | null;
  observedAt: string;
}

export interface MarketView {
  id: string;
  eventId: string;
  sourceKey: string;
  sourceMarketId: string;
  period: string;
  family: string;
  marketType: string;
  participant: string | null;
  line: string | null;
  status: string;
  settlementRuleVersion: number;
  odds: OddsView[];
}

export interface OpportunityLegView {
  id: string;
  selectionId: string;
  bookmaker: string;
  market: {
    family: string;
    marketType: string;
    period: string;
    participant: string | null;
    line: string | null;
  };
  outcome: string;
  oddsSnapshot: number;
  stake: number | null;
  guaranteedReturn: number | null;
  settlementResult: string | null;
}

export interface OpportunityEventView {
  id: string;
  competition: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  status: string;
}

export interface OpportunityView {
  id: string;
  event: OpportunityEventView;
  status: string;
  rejectionReason: string | null;
  marketStructure: string | null;
  totalStake: number | null;
  minReturn: number | null;
  guaranteedProfit: number | null;
  roi: number | null;
  worstState: string | null;
  engineVersion: string;
  normalizerVersion: string | null;
  settlementVersion: string | null;
  optimizerVersion: string | null;
  detectedAt: string;
  validatedAt: string | null;
  expiresAt: string | null;
  legs: OpportunityLegView[];
}

export interface ProviderView {
  key: string;
  displayName: string;
  baseUrl: string | null;
  status: string;
  lastSeenAt: string | null;
}

export interface AdminSourceView extends ProviderView {
  marketCount: number;
  rawPayloadCount: number;
  scannerRunCount: number;
  settlementRuleCount: number;
}

export interface ScannerRunView {
  runId: string;
  sourceKey: string | null;
  status: string;
  message: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface AuditLogView {
  id: string;
  opportunityId: string | null;
  entityType: string | null;
  entityId: string | null;
  action: string;
  actor: string | null;
  detail: unknown;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export interface ApiRepo {
  listEvents(filter: EventFilter): Promise<Page<EventView>>;
  getEvent(id: string): Promise<EventView | null>;
  listMarkets(filter: MarketFilter): Promise<Page<MarketView>>;
  getMarket(id: string): Promise<MarketView | null>;
  listOdds(filter: OddsFilter): Promise<Page<OddsView>>;
  listOpportunities(filter: OpportunityFilter): Promise<Page<OpportunityView>>;
  getOpportunity(id: string): Promise<OpportunityView | null>;
  listProviders(): Promise<ProviderView[]>;
  listScannerRuns(limit: number): Promise<ScannerRunView[]>;
  listAdminSources(): Promise<AdminSourceView[]>;
  listAuditLogs(filter: AuditLogFilter): Promise<Page<AuditLogView>>;
}

// ---------------------------------------------------------------------------
// History read model (Phase 15)
// ---------------------------------------------------------------------------

export interface EpisodeHistoryFilter {
  eventCanonicalId?: string;
  status?: string;
  limit?: number;
}

export interface OddsHistoryFilterView {
  selectionId?: string;
  eventCanonicalId?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export interface SourceLatencyFilter {
  sourceKey?: string;
  after?: string;
  limit?: number;
}

export interface FalsePositiveFilter {
  after?: string;
}

/**
 * Historical reconstruction read model (Phase 15): opportunity episodes,
 * per-leg odds price series, source latency and false-positive analysis. The
 * DTOs (EpisodeReconstruction, OddsHistoryPoint, ...) match the values in
 * ./history.ts and are JSON-safe for the wire.
 */
export interface HistoryRepo {
  listEpisodes(filter: EpisodeHistoryFilter): Promise<OpportunityEpisodeSummary[]>;
  getEpisodeReconstruction(episodeId: string): Promise<EpisodeReconstruction | null>;
  listOddsHistory(filter: OddsHistoryFilterView): Promise<OddsHistoryPoint[]>;
  sourceLatency(filter: SourceLatencyFilter): Promise<SourceLatencyStat[]>;
  falsePositiveAnalysis(filter: FalsePositiveFilter): Promise<FalsePositiveReport>;
}