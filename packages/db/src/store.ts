/**
 * @22void/db — write-side store for scanner workers (Phase 14).
 *
 * The worker runtime (workers/odds-collector) persists one cycle of canonical
 * records here and reads back priced selections for detection. This module is
 * deliberately decoupled from the worker packages (docs/ARCHITECTURE.md): it
 * imports only Prisma types and its own JSON-safe input DTOs. Detection uses
 * plain structural rows (DbPricedSelection) which the worker adapts to its own
 * candidate types — the DB layer never depends on @22void/arbitrage or
 * @22void/provider-contracts.
 *
 * Persistence is idempotent by design: events key on canonicalEventId, source
 * bindings on (oddsSourceId, sourceEventId), markets on (oddsSourceId,
 * sourceMarketId), selections on (marketId, bookmakerId, outcome), settlement
 * rules on (oddsSourceId, family, marketType, version). A market cannot exist
 * without its settlement rule (Rule 3), which is why the persist job ensures
 * the rule before the market.
 */

import type {
  Bookmaker,
  EventStatus,
  Market,
  MarketFamily,
  Opportunity,
  Period,
  Prisma,
  PrismaClient,
  Selection,
  SourceStatus,
} from "./generated/client/client";
import { SelectionOutcomeType as SelectionOutcomeEnum } from "./generated/client/client";
import { computeOpportunityKey, legKeyFromSelectionIds, upsertOpportunityEpisodeTx } from "./history";
import { ensureOddsSource } from "./raw-payloads";

export type DbClient = PrismaClient;
type Tx = Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Input DTOs (plain, JSON-safe where possible)
// ---------------------------------------------------------------------------

/** One canonical event to persist with its provider bindings. */
export interface PersistEventInput {
  canonicalEventId: string;
  sport?: string;
  competition: string;
  homeTeam: string;
  awayTeam: string;
  /** ISO 8601 start time. */
  startTime: string;
  status: EventStatus;
  sources: PersistEventSourceInput[];
}

export interface PersistEventSourceInput {
  provider: string;
  sourceEventId: string;
  /** Event-normalization confidence in [0, 1] (Phase 4). */
  eventConfidence?: number;
}

export interface PersistMarketInput {
  provider: string;
  sourceMarketId: string;
  /** Canonical event id the market belongs to. */
  eventCanonicalId: string;
  family: MarketFamily;
  marketType: string;
  period: Period;
  participant?: string | null;
  line?: string | null;
}

export interface PersistSelectionInput {
  provider: string;
  /** Market identity within the same provider run. */
  sourceMarketId: string;
  bookmaker: string;
  outcome: string;
  odds: number;
  observedAt: string;
  sourceUpdatedAt?: string;
  suspended?: boolean;
}

/** A canonical record that cannot be persisted; counted, never guessed. */
export interface PersistInvalidRef {
  ref: string;
  reason: string;
}

export interface PersistCanonicalRunInput {
  provider: string;
  events: PersistEventInput[];
  markets: PersistMarketInput[];
  selections: PersistSelectionInput[];
  invalid?: PersistInvalidRef[];
}

export interface PersistCanonicalRunResult {
  events: number;
  markets: number;
  selections: number;
  observations: number;
  invalid: number;
}

// ---------------------------------------------------------------------------
// Outcome mapping
// ---------------------------------------------------------------------------

const SELECTION_OUTCOME_VALUES = new Set<string>(Object.values(SelectionOutcomeEnum));

/**
 * Map a canonical outcome string to the DB enum. Selection outcomes that the
 * schema cannot represent (free-form scorelines such as "2-1") return `null`
 * and are counted as invalid — raw payload retention keeps the verbatim price
 * history (§65). The DB layer never guesses at a representation.
 */
export function toSelectionOutcomeType(
  outcome: string
): (typeof SelectionOutcomeEnum)[keyof typeof SelectionOutcomeEnum] | null {
  return SELECTION_OUTCOME_VALUES.has(outcome) ? (outcome as (typeof SelectionOutcomeEnum)[keyof typeof SelectionOutcomeEnum]) : null;
}

// ---------------------------------------------------------------------------
// Idempotent upserts
// ---------------------------------------------------------------------------

/** Ensure the standard settlement rule (version 1) exists for a source market. */
async function ensureSettlementRule(
  tx: Tx,
  oddsSourceId: string,
  family: MarketFamily,
  marketType: string,
  oddsSourceKey: string
): Promise<string> {
  const version = 1;
  const existing = await tx.settlementRule.findUnique({
    where: {
      oddsSourceId_family_marketType_version: { oddsSourceId, family, marketType, version },
    },
  });
  if (existing !== null) return existing.id;
  const created = await tx.settlementRule.create({
    data: {
      oddsSourceId,
      family,
      marketType,
      version,
      description: "Standard engine rule set (ARBITRAGE_ENGINE_SPEC §9–§16).",
      ruleJson: { version, provider: oddsSourceKey },
    },
  });
  return created.id;
}

async function ensureBookmaker(tx: Tx, name: string): Promise<Bookmaker> {
  const existing = await tx.bookmaker.findUnique({ where: { name } });
  if (existing !== null) return existing;
  return tx.bookmaker.create({ data: { name } });
}

async function upsertSelection(
  tx: Tx,
  input: PersistSelectionInput,
  market: Market
): Promise<{ created: boolean; changed: boolean } | null> {
  const mapped = toSelectionOutcomeType(input.outcome);
  if (mapped === null) return null;
  const bookmaker = await ensureBookmaker(tx, input.bookmaker);
  const key = {
    marketId: market.id,
    bookmakerId: bookmaker.id,
    outcome: mapped,
  };
  const existing = await tx.selection.findUnique({
    where: { marketId_bookmakerId_outcome: key },
  });
  const observedAt = new Date(input.observedAt);
  if (existing !== null) {
    const current = Number(existing.odds);
    const changed = current !== input.odds;
    const data = {
      odds: input.odds,
      observedAt,
      ...(input.sourceUpdatedAt !== undefined
        ? { sourceUpdatedAt: new Date(input.sourceUpdatedAt) }
        : {}),
    };
    await tx.selection.update({ where: { id: existing.id }, data });
    if (changed) {
      await tx.oddsObservation.create({
        data: { selectionId: existing.id, odds: input.odds, observedAt },
      });
    }
    return { created: false, changed };
  }
  const created = await tx.selection.create({
    data: {
      marketId: market.id,
      bookmakerId: bookmaker.id,
      outcome: mapped,
      odds: input.odds,
      observedAt,
      ...(input.sourceUpdatedAt !== undefined
        ? { sourceUpdatedAt: new Date(input.sourceUpdatedAt) }
        : {}),
    },
    select: { id: true },
  });
  await tx.oddsObservation.create({
    data: { selectionId: created.id, odds: input.odds, observedAt },
  });
  return { created: true, changed: false };
}

// ---------------------------------------------------------------------------
// Persist one canonical run
// ---------------------------------------------------------------------------

/**
 * Persist one collected run idempotently. Events are upserted first (markets
 * and selections reference them), then settlement rules, markets and finally
 * selections with an odds observation per distinct price (first quote and every
 * subsequent change — the price series Phase 15 reconstructs from). Returns
 * row/work counts; unmappable outcomes and unknown events count invalid.
 */
export async function persistCanonicalRun(
  db: DbClient,
  input: PersistCanonicalRunInput
): Promise<PersistCanonicalRunResult> {
  const invalid = [...(input.invalid ?? [])];
  const source = await ensureOddsSource(db, input.provider);

  return db.$transaction(async (tx) => {
    const eventByCanonicalId = new Map<string, string>();
    let events = 0;
    let markets = 0;
    let selections = 0;
    let observations = 0;

    for (const event of input.events) {
      const existing = await tx.event.findUnique({
        where: { canonicalEventId: event.canonicalEventId },
      });
      if (existing === null) {
        await tx.event.create({
          data: {
            canonicalEventId: event.canonicalEventId,
            sport: event.sport ?? "football",
            competition: event.competition,
            homeTeam: event.homeTeam,
            awayTeam: event.awayTeam,
            startTime: new Date(event.startTime),
            status: event.status,
          },
        });
      } else {
        await tx.event.update({
          where: { id: existing.id },
          data: {
            sport: event.sport ?? existing.sport,
            competition: event.competition,
            homeTeam: event.homeTeam,
            awayTeam: event.awayTeam,
            startTime: new Date(event.startTime),
            status: event.status,
          },
        });
      }
      const created = await tx.event.findUnique({
        where: { canonicalEventId: event.canonicalEventId },
        select: { id: true },
      });
      if (created === null) {
        invalid.push({
          ref: event.canonicalEventId,
          reason: "event could not be resolved after upsert",
        });
        continue;
      }
      eventByCanonicalId.set(event.canonicalEventId, created.id);
      events += 1;

      for (const ref of event.sources) {
        const sourceRef = await ensureOddsSource(tx, ref.provider);
        const data = {
          eventId: created.id,
          oddsSourceId: sourceRef.id,
          sourceEventId: ref.sourceEventId,
          startTime: new Date(event.startTime),
          homeTeam: event.homeTeam,
          awayTeam: event.awayTeam,
          competition: event.competition,
          ...(ref.eventConfidence !== undefined ? { eventConfidence: ref.eventConfidence } : {}),
        };
        await tx.sourceEventId.upsert({
          where: {
            oddsSourceId_sourceEventId: {
              oddsSourceId: sourceRef.id,
              sourceEventId: ref.sourceEventId,
            },
          },
          update: data,
          create: data,
        });
      }
    }

    const ruleByKey = new Map<string, string>();
    const marketBySourceKey = new Map<string, Market>();
    for (const market of input.markets) {
      const eventId = eventByCanonicalId.get(market.eventCanonicalId);
      if (eventId === undefined) {
        invalid.push({ ref: market.sourceMarketId, reason: `unknown event ${market.eventCanonicalId}` });
        continue;
      }
      const ruleKey = `${market.family}|${market.marketType}`;
      let ruleId = ruleByKey.get(ruleKey);
      if (ruleId === undefined) {
        ruleId = await ensureSettlementRule(tx, source.id, market.family, market.marketType, source.key);
        ruleByKey.set(ruleKey, ruleId);
      }
      const existing = await tx.market.findUnique({
        where: { oddsSourceId_sourceMarketId: { oddsSourceId: source.id, sourceMarketId: market.sourceMarketId } },
      });
      const data = {
        eventId,
        oddsSourceId: source.id,
        sourceMarketId: market.sourceMarketId,
        settlementRuleId: ruleId,
        period: market.period,
        family: market.family,
        marketType: market.marketType,
        ...(market.participant !== undefined && market.participant !== null
          ? { participant: market.participant }
          : {}),
        ...(market.line !== undefined && market.line !== null ? { line: market.line } : {}),
      };
      let row: Market;
      if (existing === null) {
        row = await tx.market.create({ data });
      } else {
        row = await tx.market.update({ where: { id: existing.id }, data });
      }
      marketBySourceKey.set(market.sourceMarketId, row);
      markets += 1;
    }

    for (const selection of input.selections) {
      const market = marketBySourceKey.get(selection.sourceMarketId);
      if (market === undefined) {
        invalid.push({ ref: selection.bookmaker, reason: `unknown market ${selection.sourceMarketId}` });
        continue;
      }
      const result = await upsertSelection(tx, selection, market);
      if (result === null) {
        invalid.push({
          ref: selection.bookmaker,
          reason: `outcome "${selection.outcome}" is not representable in the DB enum`,
        });
        continue;
      }
      selections += 1;
      if (result.created || result.changed) observations += 1;
    }

    return { events, markets, selections, observations, invalid: invalid.length };
  });
}

// ---------------------------------------------------------------------------
// Detection reader — priced selections from the persisted state
// ---------------------------------------------------------------------------

/** Supplier availability in the detection model's vocabulary. */
export type DbSourceStatus = "OK" | "DEGRADED" | "DOWN" | "UNKNOWN";

/** A current priced selection, structurally compatible with detection legs. */
export interface DbPricedSelection {
  id: string;
  eventId: string;
  family: MarketFamily;
  marketType: string;
  period: Period;
  participant: string | null;
  line: string | null;
  outcome: Selection["outcome"];
  odds: number;
  bookmaker: string;
  observedAt: number;
  sourceUpdatedAt?: string;
  provider: string;
  sourceStatus: DbSourceStatus;
  eventConfidence?: number;
  settlementRuleVersion: string;
  settlementConfidence: number;
}

function mapSourceStatus(status: SourceStatus): DbSourceStatus {
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

/**
 * Load the current priced selections across the persisted state. Event
 * confidence is the minimum attestation across the event's source bindings
 * (absent when no binding carries one). Settlement confidence is 1.0 whenever
 * a settlement rule row exists — the DB enforces the market→rule FK (Rule 3).
 */
export async function loadPricedSelections(
  db: DbClient,
  options: { eventId?: string } = {}
): Promise<DbPricedSelection[]> {
  const rows = await db.selection.findMany({
    include: {
      bookmaker: true,
      market: {
        include: {
          event: { include: { sourceEventIds: { select: { eventConfidence: true } } } },
          oddsSource: true,
          settlementRule: true,
        },
      },
    },
    where:
      options.eventId === undefined
        ? {}
        : { market: { event: { canonicalEventId: options.eventId } } },
  });

  return rows.map((row) => {
    const confidences = row.market.event.sourceEventIds.map((link) => link.eventConfidence);
    const hasConfidence =
      confidences.every((value): value is number => value !== null && value !== undefined) &&
      confidences.length > 0;
    return {
      id: row.id,
      eventId: row.market.event.canonicalEventId,
      family: row.market.family,
      marketType: row.market.marketType,
      period: row.market.period,
      participant: row.market.participant,
      line: row.market.line,
      outcome: row.outcome,
      odds: Number(row.odds),
      bookmaker: row.bookmaker.name,
      observedAt: row.observedAt.getTime(),
      ...(row.sourceUpdatedAt !== null ? { sourceUpdatedAt: row.sourceUpdatedAt.toISOString() } : {}),
      provider: row.market.oddsSource.key,
      sourceStatus: mapSourceStatus(row.market.oddsSource.status),
      ...(hasConfidence ? { eventConfidence: Math.min(...confidences) } : {}),
      settlementRuleVersion: String(row.market.settlementRule.version),
      settlementConfidence: 1,
    };
  });
}

// ---------------------------------------------------------------------------
// Source status, heartbeats and opportunities
// ---------------------------------------------------------------------------

/** Set a source's availability status and last-seen timestamp. */
export async function markSourceStatus(
  db: DbClient,
  sourceKey: string,
  status: SourceStatus,
  lastSeenAt: Date = new Date()
): Promise<void> {
  await db.oddsSource.update({
    where: { key: sourceKey },
    data: { status, lastSeenAt },
  });
}

export interface RecordHeartbeatInput {
  runId: string;
  oddsSourceId?: string;
  status: SourceStatus;
  message?: string;
  startedAt?: Date;
  finishedAt?: Date;
}

export interface HeartbeatRow {
  id: string;
  runId: string;
  status: SourceStatus;
  message: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

/** Append one scanner-health heartbeat row (spec §66). */
export async function recordHeartbeat(
  db: DbClient,
  input: RecordHeartbeatInput
): Promise<HeartbeatRow> {
  const row = await db.scannerHealth.create({
    data: {
      runId: input.runId,
      ...(input.oddsSourceId !== undefined
        ? { oddsSource: { connect: { id: input.oddsSourceId } } }
        : {}),
      status: input.status,
      ...(input.message !== undefined ? { message: input.message } : {}),
      ...(input.startedAt !== undefined ? { startedAt: input.startedAt } : {}),
      ...(input.finishedAt !== undefined ? { finishedAt: input.finishedAt } : {}),
    },
  });
  return {
    id: row.id,
    runId: row.runId,
    status: row.status,
    message: row.message,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

export interface PersistOpportunityLegInput {
  selectionId: string;
  oddsSnapshot: number;
  stake?: number;
  guaranteedReturn?: number;
}

export interface PersistOpportunityAuditInput {
  action: string;
  actor?: string;
  detail?: Prisma.InputJsonValue;
}

export interface PersistOpportunityInput {
  id?: string;
  eventCanonicalId: string;
  status: Opportunity["status"];
  rejectionReason?: Opportunity["rejectionReason"];
  marketStructure?: string;
  totalStake?: number;
  minReturn?: number;
  guaranteedProfit?: number;
  roi?: number;
  worstState?: string;
  engineVersion: string;
  normalizerVersion?: string;
  settlementVersion?: string;
  optimizerVersion?: string;
  detectedAt?: string;
  validatedAt?: string;
  expiresAt?: string;
  /**
   * Deterministic episode identity (Phase 15). When omitted it is derived from
   * the event, structure and sorted leg selection ids.
   */
  opportunityKey?: string;
  legs: PersistOpportunityLegInput[];
  audit: PersistOpportunityAuditInput[];
}

/**
 * Persist one opportunity with its legs and audit trail. The event and housing
 * selections must already exist (they come from the same persisted run).
 *
 * When the opportunity has legs it is grouped into (or creates) an
 * `opportunity_episodes` row keyed by {event, structure, sorted selection ids}:
 * first seen / last seen / detected count are maintained so the historical
 * layer can reconstruct the arb's lifetime (Phase 15). The episode upsert and
 * the snapshot row commit atomically in one transaction.
 */
export async function persistOpportunity(
  db: DbClient,
  input: PersistOpportunityInput,
): Promise<Opportunity> {
  const event = await db.event.findUnique({
    where: { canonicalEventId: input.eventCanonicalId },
    select: { id: true },
  });
  if (event === null) {
    throw new Error(`cannot persist opportunity: unknown event ${input.eventCanonicalId}`);
  }
  const detectedAt = input.detectedAt !== undefined ? new Date(input.detectedAt) : new Date();

  return db.$transaction(async (tx) => {
    const legSelectionIds = input.legs.map((leg) => leg.selectionId);
    let episodeId: string | undefined;
    if (legSelectionIds.length > 0) {
      const legKey = legKeyFromSelectionIds(legSelectionIds);
      const episodeKey =
        input.opportunityKey ??
        computeOpportunityKey({
          eventCanonicalId: input.eventCanonicalId,
          structureType: input.marketStructure ?? "",
          selectionIds: legSelectionIds,
        });
      const episode = await upsertOpportunityEpisodeTx(tx, {
        id: episodeKey,
        eventId: event.id,
        structureType: input.marketStructure ?? "",
        legKey,
        ...(input.marketStructure !== undefined ? { marketStructure: input.marketStructure } : {}),
        status: input.status,
        seenAt: detectedAt,
      });
      episodeId = episode.id;
    }

    const row = await tx.opportunity.create({
      data: {
        ...(input.id !== undefined ? { id: input.id } : {}),
        event: { connect: { id: event.id } },
        ...(episodeId !== undefined ? { episode: { connect: { id: episodeId } } } : {}),
        status: input.status,
        ...(input.rejectionReason !== undefined ? { rejectionReason: input.rejectionReason } : {}),
        ...(input.marketStructure !== undefined ? { marketStructure: input.marketStructure } : {}),
        ...(input.totalStake !== undefined ? { totalStake: input.totalStake } : {}),
        ...(input.minReturn !== undefined ? { minReturn: input.minReturn } : {}),
        ...(input.guaranteedProfit !== undefined ? { guaranteedProfit: input.guaranteedProfit } : {}),
        ...(input.roi !== undefined ? { roi: input.roi } : {}),
        ...(input.worstState !== undefined ? { worstState: input.worstState } : {}),
        engineVersion: input.engineVersion,
        ...(input.normalizerVersion !== undefined ? { normalizerVersion: input.normalizerVersion } : {}),
        ...(input.settlementVersion !== undefined ? { settlementVersion: input.settlementVersion } : {}),
        ...(input.optimizerVersion !== undefined ? { optimizerVersion: input.optimizerVersion } : {}),
        detectedAt,
        ...(input.validatedAt !== undefined ? { validatedAt: new Date(input.validatedAt) } : {}),
        ...(input.expiresAt !== undefined ? { expiresAt: new Date(input.expiresAt) } : {}),
        legs: {
          create: input.legs.map((leg) => ({
            selection: { connect: { id: leg.selectionId } },
            oddsSnapshot: leg.oddsSnapshot,
            ...(leg.stake !== undefined ? { stake: leg.stake } : {}),
            ...(leg.guaranteedReturn !== undefined ? { guaranteedReturn: leg.guaranteedReturn } : {}),
          })),
        },
        auditLogs: {
          create: input.audit.map((entry) => ({
            action: entry.action,
            ...(entry.actor !== undefined ? { actor: entry.actor } : {}),
            ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
          })),
        },
      },
    });
    return row;
  });
}