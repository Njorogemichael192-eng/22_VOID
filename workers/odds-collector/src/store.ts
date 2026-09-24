/**
 * Worker store port (Phase 14).
 *
 * `WorkerStore` is the persistence contract the scan cycle orchestrates
 * against. Two implementations ship:
 *
 * - `createMemoryWorkerStore()` — in-memory stand-in for tests and a sandbox
 *   run without a database (mirrors the Prisma-backed semantics closely).
 * - `createDbWorkerStore(db)` — the real adapter onto @22void/db, which owns
 *   all SQL. The worker never talks to Prisma directly.
 *
 * Raw-payload capture (§65) flows through `storeRaw`; heartbeats and source
 * availability through `recordHeartbeat` / `markSourceStatus`; the detection
 * job reads priced selections via `loadPricedSelections`.
 */

import {
  computeOpportunityKey,
  ensureOddsSource,
  loadPricedSelections,
  markSourceStatus as dbMarkSourceStatus,
  persistCanonicalRun,
  persistOpportunity as dbPersistOpportunity,
  recordHeartbeat as dbRecordHeartbeat,
  storeRawPayload,
  sweepOpportunityEpisodes,
  toSelectionOutcomeType,
  type DbPricedSelection,
  type PersistCanonicalRunInput,
  type PersistCanonicalRunResult,
  type PersistOpportunityInput,
  type Prisma,
  type PrismaClient,
} from "@22void/db";
import type { RawProviderPayload } from "@22void/provider-contracts";

export type WorkerSourceStatus = "UNKNOWN" | "HEALTHY" | "DEGRADED" | "DOWN";

export interface ReconcileCounts {
  disappeared: number;
  restored: number;
}

/** One canonical event the normalization job resumes from. */
export interface PersistedEventSeed {
  canonicalEventId: string;
  competition: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  sourceBindings: Array<{ provider: string; sourceEventId: string }>;
}

export interface WorkerHeartbeatInput {
  runId: string;
  sourceKey?: string;
  status: WorkerSourceStatus;
  message?: string;
  startedAt?: Date;
  finishedAt?: Date;
}

export interface WorkerStore {
  loadEventSeeds(): Promise<PersistedEventSeed[]>;
  persistRun(input: PersistCanonicalRunInput): Promise<PersistCanonicalRunResult>;
  loadPricedSelections(options?: { eventId?: string }): Promise<DbPricedSelection[]>;
  getSourceStatus(sourceKey: string): Promise<WorkerSourceStatus>;
  markSourceStatus(sourceKey: string, status: WorkerSourceStatus): Promise<void>;
  recordHeartbeat(input: WorkerHeartbeatInput): Promise<void>;
  storeRaw(payload: RawProviderPayload): Promise<void>;
  persistOpportunity(input: PersistOpportunityInput): Promise<void>;
  /**
   * Phase 15 reconciliation sweep: mark episodes absent from this healthy
   * cycle's detections as disappeared, restore any that came back.
   */
  reconcileOpportunityEpisodes(activeKeys: string[], now: number): Promise<ReconcileCounts>;
}

// ---------------------------------------------------------------------------
// Prisma-backed implementation
// ---------------------------------------------------------------------------

export function createDbWorkerStore(db: PrismaClient): WorkerStore {
  return {
    async loadEventSeeds(): Promise<PersistedEventSeed[]> {
      const rows = await db.event.findMany({
        include: { sourceEventIds: { include: { oddsSource: true } } },
      });
      return rows.map((row) => ({
        canonicalEventId: row.canonicalEventId,
        competition: row.competition,
        homeTeam: row.homeTeam,
        awayTeam: row.awayTeam,
        startTime: row.startTime.toISOString(),
        sourceBindings: row.sourceEventIds.map((link) => ({
          provider: link.oddsSource.key,
          sourceEventId: link.sourceEventId,
        })),
      }));
    },

    async persistRun(input: PersistCanonicalRunInput): Promise<PersistCanonicalRunResult> {
      return persistCanonicalRun(db, input);
    },

    async loadPricedSelections(options?: { eventId?: string }): Promise<DbPricedSelection[]> {
      return loadPricedSelections(db, options);
    },

    async getSourceStatus(sourceKey: string): Promise<WorkerSourceStatus> {
      const source = await db.oddsSource.findUnique({ where: { key: sourceKey } });
      return source?.status ?? "UNKNOWN";
    },

    async markSourceStatus(sourceKey: string, status: WorkerSourceStatus): Promise<void> {
      await dbMarkSourceStatus(db, sourceKey, status);
    },

    async recordHeartbeat(input: WorkerHeartbeatInput): Promise<void> {
      const oddsSourceId =
        input.sourceKey === undefined
          ? undefined
          : (await ensureOddsSource(db, input.sourceKey)).id;
      await dbRecordHeartbeat(db, {
        runId: input.runId,
        ...(oddsSourceId !== undefined ? { oddsSourceId } : {}),
        status: input.status,
        ...(input.message !== undefined ? { message: input.message } : {}),
        ...(input.startedAt !== undefined ? { startedAt: input.startedAt } : {}),
        ...(input.finishedAt !== undefined ? { finishedAt: input.finishedAt } : {}),
      });
    },

    async storeRaw(payload: RawProviderPayload): Promise<void> {
      const source = await ensureOddsSource(db, payload.provider);
      await storeRawPayload({
        db,
        oddsSourceId: source.id,
        requestId: payload.requestId,
        ...(payload.endpoint !== undefined ? { endpoint: payload.endpoint } : {}),
        payload: payload.payload as Prisma.InputJsonValue,
        receivedAt: new Date(payload.receivedAt),
      });
    },

    async persistOpportunity(input: PersistOpportunityInput): Promise<void> {
      await dbPersistOpportunity(db, input);
    },

    async reconcileOpportunityEpisodes(activeKeys: string[], now: number): Promise<ReconcileCounts> {
      return sweepOpportunityEpisodes(db, activeKeys, new Date(now));
    },
  };
}

// ---------------------------------------------------------------------------
// In-memory implementation (tests / sandbox)
// ---------------------------------------------------------------------------

interface MemoryEvent {
  canonicalEventId: string;
  competition: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  sources: Array<{ provider: string; sourceEventId: string; eventConfidence?: number }>;
}

interface MemoryMarket {
  id: string;
  sourceMarketId: string;
  eventCanonicalId: string;
  family: DbPricedSelection["family"];
  marketType: string;
  period: DbPricedSelection["period"];
  participant: string | null;
  line: string | null;
}

interface MemorySelection {
  id: string;
  bookmaker: string;
  outcome: DbPricedSelection["outcome"];
  odds: number;
  observedAt: number;
  sourceUpdatedAt: number | undefined;
}

const marketKey = (sourceKey: string, sourceMarketId: string): string =>
  `${sourceKey}|${sourceMarketId}`;

export interface MemoryWorkerStore extends WorkerStore {
  debugHeartbeats(): WorkerHeartbeatInput[];
  debugOpportunities(): PersistOpportunityInput[];
  debugRawPayloads(): RawProviderPayload[];
  debugEpisodes(): MemoryEpisodeDebug[];
}

export interface MemoryEpisodeDebug {
  key: string;
  eventCanonicalId: string;
  structureType: string;
  status: PersistOpportunityInput["status"];
  firstSeenAt: number;
  lastSeenAt: number;
  detectedCount: number;
  disappearedAt: number | undefined;
}

function toDbSourceStatus(status: WorkerSourceStatus): DbPricedSelection["sourceStatus"] {
  switch (status) {
    case "HEALTHY":
      return "OK";
    case "DEGRADED":
      return "DEGRADED";
    case "DOWN":
      return "DOWN";
    default:
      return "UNKNOWN";
  }
}

export function createMemoryWorkerStore(providerKeys: string[] = []): MemoryWorkerStore {
  const events = new Map<string, MemoryEvent>();
  const markets = new Map<string, MemoryMarket>();
  const selections = new Map<string, MemorySelection>();
  const bookmakers = new Set<string>();
  const sourceStatus = new Map<string, WorkerSourceStatus>();
  for (const key of providerKeys) sourceStatus.set(key, "UNKNOWN");
  const rawPayloads: RawProviderPayload[] = [];
  const heartbeats: WorkerHeartbeatInput[] = [];
  const opportunities: PersistOpportunityInput[] = [];
  const episodes = new Map<
    string,
    {
      eventCanonicalId: string;
      structureType: string;
      status: PersistOpportunityInput["status"];
      firstSeenAt: number;
      lastSeenAt: number;
      detectedCount: number;
      disappearedAt: number | undefined;
    }
  >();
  let counter = 0;

  const loadPriced = (): DbPricedSelection[] => {
    const rows: DbPricedSelection[] = [];
    for (const [key, selection] of selections) {
      const [sourceKey, sourceMarketId] = key.split("|") as [string, string];
      const market = markets.get(marketKey(sourceKey, sourceMarketId));
      if (market === undefined) continue;
      const event = events.get(market.eventCanonicalId);
      if (event === undefined) continue;
      const confidences = event.sources
        .map((source) => source.eventConfidence)
        .filter((value): value is number => value !== undefined);
      const hasConfidence = confidences.length === event.sources.length && confidences.length > 0;
      rows.push({
        id: selection.id,
        eventId: event.canonicalEventId,
        family: market.family,
        marketType: market.marketType,
        period: market.period,
        participant: market.participant,
        line: market.line,
        outcome: selection.outcome,
        odds: selection.odds,
        bookmaker: selection.bookmaker,
        observedAt: selection.observedAt,
        ...(selection.sourceUpdatedAt !== undefined
          ? { sourceUpdatedAt: new Date(selection.sourceUpdatedAt).toISOString() }
          : {}),
        provider: sourceKey,
        sourceStatus: toDbSourceStatus(sourceStatus.get(sourceKey) ?? "UNKNOWN"),
        ...(hasConfidence ? { eventConfidence: Math.min(...confidences) } : {}),
        settlementRuleVersion: "1",
        settlementConfidence: 1,
      });
    }
    return rows;
  };

  return {
    async loadEventSeeds(): Promise<PersistedEventSeed[]> {
      return [...events.values()].map((event) => ({
        canonicalEventId: event.canonicalEventId,
        competition: event.competition,
        homeTeam: event.homeTeam,
        awayTeam: event.awayTeam,
        startTime: event.startTime,
        sourceBindings: event.sources.map((source) => ({
          provider: source.provider,
          sourceEventId: source.sourceEventId,
        })),
      }));
    },

    async persistRun(input: PersistCanonicalRunInput): Promise<PersistCanonicalRunResult> {
      let invalid = input.invalid?.length ?? 0;
      let eventsCount = 0;
      let marketsCount = 0;
      let selectionsCount = 0;
      let observations = 0;

      for (const event of input.events) {
        const existing = events.get(event.canonicalEventId);
        if (existing === undefined) eventsCount += 1;
        events.set(event.canonicalEventId, {
          canonicalEventId: event.canonicalEventId,
          competition: event.competition,
          homeTeam: event.homeTeam,
          awayTeam: event.awayTeam,
          startTime: event.startTime,
          sources: event.sources,
        });
      }

      for (const market of input.markets) {
        const key = marketKey(market.provider, market.sourceMarketId);
        if (!markets.has(key)) {
          counter += 1;
          markets.set(key, {
            id: `mkt-${counter}`,
            sourceMarketId: market.sourceMarketId,
            eventCanonicalId: market.eventCanonicalId,
            family: market.family,
            marketType: market.marketType,
            period: market.period,
            participant: market.participant ?? null,
            line: market.line ?? null,
          });
        }
        marketsCount += 1;
      }

      for (const selection of input.selections) {
        const mapped = toSelectionOutcomeType(selection.outcome);
        const market = markets.get(marketKey(selection.provider, selection.sourceMarketId));
        if (mapped === null || market === undefined) {
          invalid += 1;
          continue;
        }
        const key = `${marketKey(selection.provider, selection.sourceMarketId)}|${selection.bookmaker}|${selection.outcome}`;
        const existing = selections.get(key);
        const observedAt = Date.parse(selection.observedAt);
        const sourceUpdatedAt =
          selection.sourceUpdatedAt !== undefined
            ? Date.parse(selection.sourceUpdatedAt)
            : undefined;
        if (existing === undefined) {
          counter += 1;
          selections.set(key, {
            id: `sel-${counter}`,
            bookmaker: selection.bookmaker,
            outcome: mapped,
            odds: selection.odds,
            observedAt,
            sourceUpdatedAt,
          });
          observations += 1;
        } else {
          if (existing.odds !== selection.odds) {
            observations += 1;
            selections.set(key, { ...existing, odds: selection.odds, observedAt, sourceUpdatedAt });
          }
        }
        bookmakers.add(selection.bookmaker);
        selectionsCount += 1;
      }

      return { events: eventsCount, markets: marketsCount, selections: selectionsCount, observations, invalid };
    },

    async loadPricedSelections(options?: { eventId?: string }): Promise<DbPricedSelection[]> {
      const rows = loadPriced();
      return options?.eventId === undefined
        ? rows
        : rows.filter((row) => row.eventId === options.eventId);
    },

    async getSourceStatus(sourceKey: string): Promise<WorkerSourceStatus> {
      return sourceStatus.get(sourceKey) ?? "UNKNOWN";
    },

    async markSourceStatus(sourceKey: string, status: WorkerSourceStatus): Promise<void> {
      sourceStatus.set(sourceKey, status);
    },

    async recordHeartbeat(input: WorkerHeartbeatInput): Promise<void> {
      heartbeats.push(input);
    },

    async storeRaw(payload: RawProviderPayload): Promise<void> {
      rawPayloads.push(payload);
    },

    async persistOpportunity(input: PersistOpportunityInput): Promise<void> {
      const event = [...events.values()].find(
        (candidate) => candidate.canonicalEventId === input.eventCanonicalId
      );
      if (event === undefined) {
        throw new Error(`cannot persist opportunity: unknown event ${input.eventCanonicalId}`);
      }
      const selectionIds = input.legs.map((leg) => leg.selectionId);
      if (selectionIds.length > 0) {
        const key =
          input.opportunityKey ??
          computeOpportunityKey({
            eventCanonicalId: input.eventCanonicalId,
            structureType: input.marketStructure ?? "",
            selectionIds,
          });
        const seenAt = Date.parse(input.detectedAt ?? new Date().toISOString());
        const existing = episodes.get(key);
        if (existing === undefined) {
          episodes.set(key, {
            eventCanonicalId: input.eventCanonicalId,
            structureType: input.marketStructure ?? "",
            status: input.status,
            firstSeenAt: seenAt,
            lastSeenAt: seenAt,
            detectedCount: 1,
            disappearedAt: undefined,
          });
        } else {
          episodes.set(key, {
            ...existing,
            status: input.status,
            lastSeenAt: seenAt,
            detectedCount: existing.detectedCount + 1,
            disappearedAt: undefined,
          });
        }
      }
      opportunities.push(input);
    },

    async reconcileOpportunityEpisodes(activeKeys: string[], now: number): Promise<ReconcileCounts> {
      const active = new Set(activeKeys);
      let disappeared = 0;
      let restored = 0;
      for (const [key, episode] of episodes) {
        if (active.has(key)) {
          if (episode.disappearedAt !== undefined) {
            episodes.set(key, { ...episode, disappearedAt: undefined });
            restored += 1;
          }
        } else if (episode.disappearedAt === undefined && episode.lastSeenAt < now) {
          episodes.set(key, { ...episode, disappearedAt: now });
          disappeared += 1;
        }
      }
      return { disappeared, restored };
    },

    debugHeartbeats() {
      return heartbeats;
    },
    debugOpportunities() {
      return opportunities;
    },
    debugRawPayloads() {
      return rawPayloads;
    },
    debugEpisodes() {
      return [...episodes.entries()].map(([key, episode]) => ({
        key,
        eventCanonicalId: episode.eventCanonicalId,
        structureType: episode.structureType,
        status: episode.status,
        firstSeenAt: episode.firstSeenAt,
        lastSeenAt: episode.lastSeenAt,
        detectedCount: episode.detectedCount,
        disappearedAt: episode.disappearedAt,
      }));
    },
  };
}