/**
 * @22void/db — historical read/analysis layer (Phase 15).
 *
 * Phase 15 turns the per-cycle evidence the worker persists into a
 * reconstructable history:
 *
 * - **Odds snapshots**: `loadOddsHistory` reads the per-selection price series
 *   from `odds_observations` (a row per distinct price, including the first).
 * - **Opportunity episodes**: detections are grouped by a deterministic
 *   identity (event + structure + sorted leg selection ids, §`computeOpportunityKey`)
 *   into an episode with first/last seen, detected count and disappearance
 *   time. `getEpisodeReconstruction` stitches the episode, its per-detection
 *   snapshots and the leg odds series back into a single record.
 * - **Source latency**: `sourceLatencyStats` aggregates poll-to-persist cycle
 *   duration from `scanner_health`.
 * - **False-positive analysis**: `falsePositiveAnalysis` classifies episodes by
 *   their latest detection status and reports the non-verified share plus the
 *   dominant rejection reasons.
 * - **Disappearance sweep**: `sweepOpportunityEpisodes` marks episodes that were
 *   absent from the latest healthy scan as disappeared (and restores those that
 *   return), feeding arb duration and disappearance time.
 *
 * This module owns SQL only; the worker orchestrates via its own small port
 * (workers/odds-collector) and the web read API maps these DTOs directly.
 */

import type {
  MarketFamily,
  OpportunityStatus,
  Period,
  Prisma,
  PrismaClient,
  Selection,
} from "./generated/client/client";

type Tx = Prisma.TransactionClient;

export type DbClient = PrismaClient;

// ---------------------------------------------------------------------------
// Episode identity
// ---------------------------------------------------------------------------

/**
 * Deterministic opportunity identity: `eventCanonicalId + structureType +
 * sorted, de-duplicated leg selection ids`. Selection ids are stable across
 * cycles (they key on source market + bookmaker + outcome), so re-detecting the
 * same legs yields the same key and the same episode.
 */
export function computeOpportunityKey(
  spec: { eventCanonicalId: string; structureType: string; selectionIds: string[] },
): string {
  const legs = [...new Set(spec.selectionIds)].sort();
  if (legs.length === 0) {
    throw new Error("opportunity key requires at least one leg selection id");
  }
  return `episode:${spec.eventCanonicalId}:${spec.structureType}:${legs.join("+")}`;
}

/** Sorted, de-duplicated leg selection ids (stable across episodes). */
export function legKeyFromSelectionIds(selectionIds: string[]): string {
  return [...new Set(selectionIds)].sort().join(",");
}

// ---------------------------------------------------------------------------
// Odds snapshots — price history per selection
// ---------------------------------------------------------------------------

export interface OddsHistoryFilter {
  selectionId?: string;
  eventCanonicalId?: string;
  /** ISO-8601 inclusive lower bound on observedAt. */
  from?: string;
  /** ISO-8601 inclusive upper bound on observedAt. */
  to?: string;
  limit?: number;
  order?: "asc" | "desc";
}

export interface OddsHistoryPoint {
  selectionId: string;
  eventCanonicalId: string;
  family: MarketFamily;
  marketType: string;
  period: Period;
  participant: string | null;
  line: string | null;
  outcome: Selection["outcome"];
  bookmaker: string;
  odds: number;
  observedAt: string;
  sourceUpdatedAt?: string;
}

/** One selection's price series. At least one of selectionId/eventCanonicalId is required. */
export async function loadOddsHistory(
  db: DbClient,
  filter: OddsHistoryFilter,
): Promise<OddsHistoryPoint[]> {
  if (filter.selectionId === undefined && filter.eventCanonicalId === undefined) {
    throw new Error("loadOddsHistory requires selectionId or eventCanonicalId");
  }
  const observedAt =
    filter.from !== undefined && filter.to !== undefined
      ? { gte: new Date(filter.from), lte: new Date(filter.to) }
      : filter.from !== undefined
        ? { gte: new Date(filter.from) }
        : filter.to !== undefined
          ? { lte: new Date(filter.to) }
          : undefined;
  const rows = await db.oddsObservation.findMany({
    where: {
      ...(filter.selectionId !== undefined ? { selectionId: filter.selectionId } : {}),
      ...(filter.eventCanonicalId !== undefined
        ? { selection: { market: { event: { canonicalEventId: filter.eventCanonicalId } } } }
        : {}),
      ...(observedAt !== undefined ? { observedAt } : {}),
    },
    orderBy: { observedAt: filter.order ?? "asc" },
    include: {
      selection: { include: { bookmaker: true, market: { include: { event: true } } } },
    },
    ...(filter.limit !== undefined ? { take: filter.limit } : {}),
  });
  return rows.map((row) => ({
    selectionId: row.selectionId,
    eventCanonicalId: row.selection.market.event.canonicalEventId,
    family: row.selection.market.family,
    marketType: row.selection.market.marketType,
    period: row.selection.market.period,
    participant: row.selection.market.participant,
    line: row.selection.market.line,
    outcome: row.selection.outcome,
    bookmaker: row.selection.bookmaker.name,
    odds: Number(row.odds),
    observedAt: row.observedAt.toISOString(),
    ...(row.sourceUpdatedAt !== null ? { sourceUpdatedAt: row.sourceUpdatedAt.toISOString() } : {}),
  }));
}

// ---------------------------------------------------------------------------
// Opportunity episodes
// ---------------------------------------------------------------------------

export interface OpportunityEpisodeSummary {
  id: string;
  eventCanonicalId: string;
  competition: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  structureType: string;
  marketStructure: string | null;
  status: OpportunityStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  detectedCount: number;
  disappearedAt: string | null;
  /** Wall-clock span the legs stayed detectable (lastSeen − firstSeen), ms. */
  durationMs: number;
}

export interface ListEpisodeOptions {
  eventCanonicalId?: string;
  status?: OpportunityStatus;
  limit?: number;
}

function mapEpisodeSummary(row: {
  id: string;
  event: { canonicalEventId: string; competition: string; homeTeam: string; awayTeam: string; startTime: Date };
  structureType: string;
  marketStructure: string | null;
  status: OpportunityStatus;
  firstSeenAt: Date;
  lastSeenAt: Date;
  detectedCount: number;
  disappearedAt: Date | null;
}): OpportunityEpisodeSummary {
  return {
    id: row.id,
    eventCanonicalId: row.event.canonicalEventId,
    competition: row.event.competition,
    homeTeam: row.event.homeTeam,
    awayTeam: row.event.awayTeam,
    startTime: row.event.startTime.toISOString(),
    structureType: row.structureType,
    marketStructure: row.marketStructure,
    status: row.status,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    detectedCount: row.detectedCount,
    disappearedAt: row.disappearedAt !== null ? row.disappearedAt.toISOString() : null,
    durationMs: row.lastSeenAt.getTime() - row.firstSeenAt.getTime(),
  };
}

/** Episodes (latest first) with their event context. */
export async function listOpportunityEpisodes(
  db: DbClient,
  options: ListEpisodeOptions = {},
): Promise<OpportunityEpisodeSummary[]> {
  const rows = await db.opportunityEpisode.findMany({
    where: {
      ...(options.eventCanonicalId !== undefined
        ? { event: { canonicalEventId: options.eventCanonicalId } }
        : {}),
      ...(options.status !== undefined ? { status: options.status } : {}),
    },
    orderBy: [{ lastSeenAt: "desc" }],
    include: { event: true },
    ...(options.limit !== undefined ? { take: options.limit } : {}),
  });
  return rows.map(mapEpisodeSummary);
}

// ---------------------------------------------------------------------------
// Historical reconstruction
// ---------------------------------------------------------------------------

export interface LegMovement {
  first: number;
  last: number;
  min: number;
  max: number;
  /** last − first. */
  delta: number;
  /** delta / first (0 when first is 0). */
  pctChange: number;
}

export interface LegReconstructionView {
  selectionId: string;
  bookmaker: string;
  outcome: Selection["outcome"];
  market: {
    family: MarketFamily;
    marketType: string;
    period: Period;
    participant: string | null;
    line: string | null;
  };
  /** Odds the first detection snapshotted for this leg. */
  snapshotOdds: number;
  history: OddsHistoryPoint[];
  movement: LegMovement;
}

export interface DetectionSnapshotView {
  id: string;
  status: OpportunityStatus;
  rejectionReason: string | null;
  marketStructure: string | null;
  detectedAt: string;
  validatedAt: string | null;
  totalStake: number | null;
  guaranteedProfit: number | null;
  roi: number | null;
  legs: Array<{
    selectionId: string;
    oddsSnapshot: number;
    stake: number | null;
    guaranteedReturn: number | null;
  }>;
}

export interface EpisodeReconstruction {
  episode: OpportunityEpisodeSummary;
  /** Every per-cycle detection snapshot in detection order. */
  detections: DetectionSnapshotView[];
  /** One entry per unique leg with its odds series through the episode window. */
  legs: LegReconstructionView[];
}

function movementOf(points: OddsHistoryPoint[], fallback: number): LegMovement {
  const values = points.map((point) => point.odds);
  if (values.length === 0) {
    return { first: fallback, last: fallback, min: fallback, max: fallback, delta: 0, pctChange: 0 };
  }
  const first = values[0] ?? fallback;
  const last = values[values.length - 1] ?? fallback;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const delta = last - first;
  return {
    first,
    last,
    min,
    max,
    delta,
    pctChange: first === 0 ? 0 : delta / first,
  };
}

/** Rebuild an episode and its legs from the persisted evidence. */
export async function getEpisodeReconstruction(
  db: DbClient,
  episodeId: string,
): Promise<EpisodeReconstruction | null> {
  const episode = await db.opportunityEpisode.findUnique({
    where: { id: episodeId },
    include: {
      event: true,
      opportunities: {
        orderBy: { detectedAt: "asc" },
        include: { legs: { include: { selection: { include: { bookmaker: true, market: true } } } } },
      },
    },
  });
  if (episode === null) return null;

  const detections: DetectionSnapshotView[] = episode.opportunities.map((row) => ({
    id: row.id,
    status: row.status,
    rejectionReason: row.rejectionReason,
    marketStructure: row.marketStructure,
    detectedAt: row.detectedAt.toISOString(),
    validatedAt: row.validatedAt !== null ? row.validatedAt.toISOString() : null,
    totalStake: row.totalStake !== null ? Number(row.totalStake) : null,
    guaranteedProfit: row.guaranteedProfit !== null ? Number(row.guaranteedProfit) : null,
    roi: row.roi !== null ? Number(row.roi) : null,
    legs: row.legs.map((leg) => ({
      selectionId: leg.selectionId,
      oddsSnapshot: Number(leg.oddsSnapshot),
      stake: leg.stake !== null ? Number(leg.stake) : null,
      guaranteedReturn: leg.guaranteedReturn !== null ? Number(leg.guaranteedReturn) : null,
    })),
  }));

  const windowFrom = episode.firstSeenAt.toISOString();
  const windowTo = episode.lastSeenAt.toISOString();

  const legs: LegReconstructionView[] = [];
  const seen = new Set<string>();
  for (const row of episode.opportunities) {
    for (const leg of row.legs) {
      if (seen.has(leg.selectionId)) continue;
      seen.add(leg.selectionId);
      const history = await loadOddsHistory(db, {
        selectionId: leg.selectionId,
        from: windowFrom,
        to: windowTo,
      });
      const snapshotOdds = Number(leg.oddsSnapshot);
      legs.push({
        selectionId: leg.selectionId,
        bookmaker: leg.selection.bookmaker.name,
        outcome: leg.selection.outcome,
        market: {
          family: leg.selection.market.family,
          marketType: leg.selection.market.marketType,
          period: leg.selection.market.period,
          participant: leg.selection.market.participant,
          line: leg.selection.market.line,
        },
        snapshotOdds,
        history,
        movement: movementOf(history, snapshotOdds),
      });
    }
  }

  return {
    episode: mapEpisodeSummary({
      id: episode.id,
      event: episode.event,
      structureType: episode.structureType,
      marketStructure: episode.marketStructure,
      status: episode.status,
      firstSeenAt: episode.firstSeenAt,
      lastSeenAt: episode.lastSeenAt,
      detectedCount: episode.detectedCount,
      disappearedAt: episode.disappearedAt,
    }),
    detections,
    legs,
  };
}

// ---------------------------------------------------------------------------
// Episode upsert (used inside persistOpportunity's transaction)
// ---------------------------------------------------------------------------

export interface OpportunityEpisodeUpsertInput {
  id: string;
  eventId: string;
  structureType: string;
  legKey: string;
  marketStructure?: string | null;
  status: OpportunityStatus;
  /** Detection time — becomes firstSeenAt on creation, lastSeenAt on re-seen. */
  seenAt: Date;
}

export interface OpportunityEpisodeUpsertResult {
  id: string;
  created: boolean;
}

/**
 * Create or extend the episode for one detected opportunity. Lookup prefers the
 * identity key, then the unique (eventId, structureType, legKey) triple so the
 * key supplied by the worker and the key derived from the legs converge; the
 * linked episode id is returned for the opportunity row's FK.
 */
export async function upsertOpportunityEpisodeTx(
  tx: Tx,
  input: OpportunityEpisodeUpsertInput,
): Promise<OpportunityEpisodeUpsertResult> {
  const byId = await tx.opportunityEpisode.findUnique({
    where: { id: input.id },
    select: { id: true },
  });
  if (byId !== null) {
    await tx.opportunityEpisode.update({
      where: { id: byId.id },
      data: {
        status: input.status,
        lastSeenAt: input.seenAt,
        detectedCount: { increment: 1 },
        disappearedAt: null,
        ...(input.marketStructure !== null && input.marketStructure !== undefined
          ? { marketStructure: input.marketStructure }
          : {}),
      },
    });
    return { id: byId.id, created: false };
  }

  const byTriple = await tx.opportunityEpisode.findUnique({
    where: {
      eventId_structureType_legKey: {
        eventId: input.eventId,
        structureType: input.structureType,
        legKey: input.legKey,
      },
    },
    select: { id: true },
  });
  if (byTriple !== null) {
    await tx.opportunityEpisode.update({
      where: { id: byTriple.id },
      data: {
        status: input.status,
        lastSeenAt: input.seenAt,
        detectedCount: { increment: 1 },
        disappearedAt: null,
        ...(input.marketStructure !== null && input.marketStructure !== undefined
          ? { marketStructure: input.marketStructure }
          : {}),
      },
    });
    return { id: byTriple.id, created: false };
  }

  await tx.opportunityEpisode.create({
    data: {
      id: input.id,
      eventId: input.eventId,
      structureType: input.structureType,
      legKey: input.legKey,
      ...(input.marketStructure !== null && input.marketStructure !== undefined
        ? { marketStructure: input.marketStructure }
        : {}),
      status: input.status,
      firstSeenAt: input.seenAt,
      lastSeenAt: input.seenAt,
      detectedCount: 1,
    },
  });
  return { id: input.id, created: true };
}

// ---------------------------------------------------------------------------
// Disappearance sweep
// ---------------------------------------------------------------------------

export interface ReconcileResult {
  disappeared: number;
  restored: number;
}

/**
 * Reconciliation sweep run after a healthy scan: episodes absent from this
 * cycle's detections and last seen strictly before `now` are marked
 * disappeared; episodes detected again are restored.
 */
export async function sweepOpportunityEpisodes(
  db: DbClient,
  activeKeys: string[],
  now: Date,
): Promise<ReconcileResult> {
  const active = [...new Set(activeKeys)];
  const stale = await db.opportunityEpisode.findMany({
    where: {
      id: { notIn: active },
      disappearedAt: null,
      lastSeenAt: { lt: now },
    },
    select: { id: true },
  });
  const restorable = await db.opportunityEpisode.findMany({
    where: { id: { in: active }, disappearedAt: { not: null } },
    select: { id: true },
  });
  if (stale.length > 0) {
    await db.opportunityEpisode.updateMany({
      where: { id: { in: stale.map((row) => row.id) } },
      data: { disappearedAt: now },
    });
  }
  if (restorable.length > 0) {
    await db.opportunityEpisode.updateMany({
      where: { id: { in: restorable.map((row) => row.id) } },
      data: { disappearedAt: null },
    });
  }
  return { disappeared: stale.length, restored: restorable.length };
}

// ---------------------------------------------------------------------------
// Source latency (scanner heartbeats)
// ---------------------------------------------------------------------------

export interface SourceLatencyStat {
  sourceKey: string;
  runs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  lastRunAt: string | null;
  lastLatencyMs: number | null;
}

export interface SourceLatencyOptions {
  sourceKey?: string;
  /** ISO-8601 lower bound on the finished scan cycles. */
  after?: string;
  limit?: number;
}

/** Poll-to-persist cycle latency per odds source (from scanner_health). */
export async function sourceLatencyStats(
  db: DbClient,
  options: SourceLatencyOptions = {},
): Promise<SourceLatencyStat[]> {
  const rows = await db.scannerHealth.findMany({
    where: {
      finishedAt: { not: null },
      ...(options.sourceKey !== undefined ? { oddsSource: { key: options.sourceKey } } : {}),
      ...(options.after !== undefined ? { finishedAt: { gte: new Date(options.after) } } : {}),
    },
    orderBy: { startedAt: "asc" },
    include: { oddsSource: true },
  });

  const bySource = new Map<string, { latencies: number[]; lastStartedAt: number }>();
  for (const row of rows) {
    if (row.finishedAt === null) continue;
    const key = row.oddsSource?.key ?? "unknown";
    const bucket = bySource.get(key) ?? { latencies: [], lastStartedAt: 0 };
    bucket.latencies.push(row.finishedAt.getTime() - row.startedAt.getTime());
    bucket.lastStartedAt = Math.max(bucket.lastStartedAt, row.startedAt.getTime());
    bySource.set(key, bucket);
  }

  const stats: SourceLatencyStat[] = [];
  for (const [sourceKey, bucket] of bySource) {
    const samples = bucket.latencies;
    const total = samples.reduce((sum, value) => sum + value, 0);
    stats.push({
      sourceKey,
      runs: samples.length,
      avgMs: total / samples.length,
      minMs: Math.min(...samples),
      maxMs: Math.max(...samples),
      lastRunAt: new Date(bucket.lastStartedAt).toISOString(),
      lastLatencyMs: samples[samples.length - 1] ?? null,
    });
  }
  stats.sort((a, b) => (b.lastRunAt ?? "").localeCompare(a.lastRunAt ?? ""));
  return options.limit === undefined ? stats : stats.slice(0, options.limit);
}

// ---------------------------------------------------------------------------
// False-positive analysis
// ---------------------------------------------------------------------------

export interface FalsePositiveByStatus {
  status: OpportunityStatus;
  count: number;
  avgDurationMs: number;
}

export interface FalsePositiveReport {
  episodes: number;
  active: number;
  concluded: number;
  verified: number;
  falsePositives: number;
  falsePositiveRate: number;
  byStatus: FalsePositiveByStatus[];
  topRejectionReasons: Array<{ reason: string; count: number }>;
}

const FALSE_POSITIVE_STATUSES: ReadonlySet<string> = new Set(["STALE", "REJECTED", "INVALIDATED"]);

/**
 * Classify episodes by their latest detection status. False positives are the
 * episodes whose latest snapshot is STALE/REJECTED/INVALIDATED rather than a
 * verified arb; the report also breaks down duration by outcome and the
 * dominant rejection reasons.
 */
export async function falsePositiveAnalysis(
  db: DbClient,
  options: { after?: string } = {},
): Promise<FalsePositiveReport> {
  const rows = await db.opportunityEpisode.findMany({
    where: {
      ...(options.after !== undefined ? { lastSeenAt: { gte: new Date(options.after) } } : {}),
    },
    include: { opportunities: { orderBy: { detectedAt: "desc" }, take: 1 } },
  });

  let verified = 0;
  let falsePositives = 0;
  let active = 0;
  const durationsByStatus = new Map<OpportunityStatus, number[]>();
  const rejectionCounts = new Map<string, number>();

  for (const row of rows) {
    if (row.disappearedAt === null) active += 1;
    const latest = row.opportunities[0];
    const status = latest?.status ?? row.status;
    const durationMs = row.lastSeenAt.getTime() - row.firstSeenAt.getTime();
    const bucket = durationsByStatus.get(status) ?? [];
    bucket.push(durationMs);
    durationsByStatus.set(status, bucket);

    if (FALSE_POSITIVE_STATUSES.has(status)) {
      falsePositives += 1;
    } else if (status === "VERIFIED_ARB") {
      verified += 1;
    }
    if (latest?.rejectionReason !== null && latest?.rejectionReason !== undefined) {
      rejectionCounts.set(latest.rejectionReason, (rejectionCounts.get(latest.rejectionReason) ?? 0) + 1);
    }
  }

  const byStatus: FalsePositiveByStatus[] = [];
  for (const [status, durations] of durationsByStatus) {
    byStatus.push({
      status,
      count: durations.length,
      avgDurationMs: durations.reduce((sum, value) => sum + value, 0) / durations.length,
    });
  }
  byStatus.sort((a, b) => b.count - a.count);

  const topRejectionReasons = [...rejectionCounts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    episodes: rows.length,
    active,
    concluded: rows.length - active,
    verified,
    falsePositives,
    falsePositiveRate: rows.length === 0 ? 0 : falsePositives / rows.length,
    byStatus,
    topRejectionReasons,
  };
}