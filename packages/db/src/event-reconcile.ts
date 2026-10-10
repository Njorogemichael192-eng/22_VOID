/**
 * @22void/db — cross-provider event reconciliation apply (Phase 19 Step 4).
 *
 * The planner (`@22void/normalization` `planEventReconcile`) decides *which*
 * persisted events fold; this module reads the stored events for that planner
 * and performs the folds transactionally. It imports only Prisma types so the
 * persistence layer stays independent of the normalization/worker packages.
 *
 * A fold moves every child of the loser event onto the winner and then deletes
 * the loser row. All four Event child relations are enumerated explicitly
 * (`sourceEventIds`, `markets`, `opportunities`, `episodes`) so the schema's
 * `onDelete: Cascade` removes nothing — market, selection, observation,
 * opportunity and audit counts are preserved exactly.
 *
 * One transaction per merge: each is a handful of indexed UPDATEs on a single
 * event's subtree plus one DELETE. Partial progress is intended — a failure on
 * pair N leaves pairs 1..N-1 committed, and because the bindings have already
 * moved, re-planning no longer proposes them, so a re-run resumes cleanly.
 */

import type { Prisma, PrismaClient } from "./generated/client/client";

export type DbClient = PrismaClient;
type Tx = Prisma.TransactionClient;

const MERGE_TRANSACTION_TIMEOUT_MS = 30_000;
const MERGE_TRANSACTION_MAX_WAIT_MS = 10_000;

export interface ReconcilableSource {
  provider: string;
  sourceEventId: string;
  eventConfidence?: number;
}

/** One persisted canonical event, in the shape the planner consumes. */
export interface ReconcilableEvent {
  canonicalEventId: string;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  startTime: string;
  createdAt: string;
  sources: ReconcilableSource[];
}

export interface ReconcileMergeInput {
  winnerCanonicalEventId: string;
  loserCanonicalEventId: string;
}

export interface ReconcilePlanInput {
  merges: readonly ReconcileMergeInput[];
}

export interface MergeMoveCounts {
  sourceEventIds: number;
  markets: number;
  opportunities: number;
  episodes: number;
}

export interface ApplyMergeResult {
  winnerEventId: string;
  loserEventId: string;
  moved: MergeMoveCounts;
}

export interface ReconcileMergeOutcome extends ReconcileMergeInput, MergeMoveCounts {
  status: "planned" | "applied" | "failed";
  durationMs: number;
  error?: string;
}

export interface ReconcileApplyResult {
  dryRun: boolean;
  requested: number;
  applied: number;
  failed: number;
  outcomes: ReconcileMergeOutcome[];
}

export interface ReconcileApplyOptions {
  /** When true, count what would move but write nothing. */
  dryRun: boolean;
  /** Optional ceiling on merges processed this run. */
  maxMerges?: number;
}

const ZERO_MOVES: MergeMoveCounts = {
  sourceEventIds: 0,
  markets: 0,
  opportunities: 0,
  episodes: 0,
};

/** Read every persisted canonical event with its provider bindings. */
export async function loadReconcileEvents(db: DbClient): Promise<ReconcilableEvent[]> {
  const rows = await db.event.findMany({
    include: {
      sourceEventIds: { include: { oddsSource: { select: { key: true } } } },
    },
    orderBy: { canonicalEventId: "asc" },
  });

  return rows.map((row) => ({
    canonicalEventId: row.canonicalEventId,
    homeTeam: row.homeTeam,
    awayTeam: row.awayTeam,
    competition: row.competition,
    startTime: row.startTime.toISOString(),
    createdAt: row.createdAt.toISOString(),
    sources: row.sourceEventIds.map((binding) => ({
      provider: binding.oddsSource.key,
      sourceEventId: binding.sourceEventId,
      ...(binding.eventConfidence !== null
        ? { eventConfidence: Number(binding.eventConfidence) }
        : {}),
    })),
  }));
}

async function resolveEventId(db: DbClient, canonicalEventId: string): Promise<string> {
  const row = await db.event.findUnique({
    where: { canonicalEventId },
    select: { id: true },
  });
  if (row === null) {
    throw new Error(`reconcile: unknown canonical event ${canonicalEventId}`);
  }
  return row.id;
}

/**
 * Move the loser's opportunity episodes onto the winner. The schema enforces a
 * unique `(eventId, structureType, legKey)`, so an episode that already exists
 * on the winner receives the loser's opportunities and the duplicate row is
 * dropped; every other episode simply changes owner.
 */
async function moveEpisodes(tx: Tx, loserId: string, winnerId: string): Promise<number> {
  const episodes = await tx.opportunityEpisode.findMany({ where: { eventId: loserId } });
  for (const episode of episodes) {
    const conflict = await tx.opportunityEpisode.findUnique({
      where: {
        eventId_structureType_legKey: {
          eventId: winnerId,
          structureType: episode.structureType,
          legKey: episode.legKey,
        },
      },
    });
    if (conflict === null) {
      await tx.opportunityEpisode.update({
        where: { id: episode.id },
        data: { eventId: winnerId },
      });
    } else {
      await tx.opportunity.updateMany({
        where: { episodeId: episode.id },
        data: { episodeId: conflict.id },
      });
      await tx.opportunityEpisode.delete({ where: { id: episode.id } });
    }
  }
  return episodes.length;
}

/**
 * Fold one loser event into a winner inside a single transaction. Throws if
 * either canonical id is unknown (the plan was built from a different state).
 */
export async function applyEventMerge(
  db: DbClient,
  input: ReconcileMergeInput
): Promise<ApplyMergeResult> {
  const winnerId = await resolveEventId(db, input.winnerCanonicalEventId);
  const loserId = await resolveEventId(db, input.loserCanonicalEventId);
  if (winnerId === loserId) {
    throw new Error(
      `reconcile: winner and loser are the same event ${input.winnerCanonicalEventId}`
    );
  }

  return db.$transaction(
    async (tx) => {
      const sourceEventIds = (
        await tx.sourceEventId.updateMany({
          where: { eventId: loserId },
          data: { eventId: winnerId },
        })
      ).count;
      const markets = (
        await tx.market.updateMany({
          where: { eventId: loserId },
          data: { eventId: winnerId },
        })
      ).count;
      const opportunities = (
        await tx.opportunity.updateMany({
          where: { eventId: loserId },
          data: { eventId: winnerId },
        })
      ).count;
      const episodes = await moveEpisodes(tx, loserId, winnerId);
      await tx.event.delete({ where: { id: loserId } });
      return {
        winnerEventId: winnerId,
        loserEventId: loserId,
        moved: { sourceEventIds, markets, opportunities, episodes },
      };
    },
    { timeout: MERGE_TRANSACTION_TIMEOUT_MS, maxWait: MERGE_TRANSACTION_MAX_WAIT_MS }
  );
}

async function countLoserChildren(
  db: DbClient,
  loserCanonicalEventId: string
): Promise<MergeMoveCounts> {
  const loserId = await resolveEventId(db, loserCanonicalEventId);
  const [sourceEventIds, markets, opportunities, episodes] = await Promise.all([
    db.sourceEventId.count({ where: { eventId: loserId } }),
    db.market.count({ where: { eventId: loserId } }),
    db.opportunity.count({ where: { eventId: loserId } }),
    db.opportunityEpisode.count({ where: { eventId: loserId } }),
  ]);
  return { sourceEventIds, markets, opportunities, episodes };
}

/**
 * Execute (or dry-run) a plan merge by merge. Never throws on a single failed
 * merge — the outcome is recorded and the run continues, so one bad pair does
 * not block the rest.
 */
export async function applyReconcilePlan(
  db: DbClient,
  plan: ReconcilePlanInput,
  options: ReconcileApplyOptions
): Promise<ReconcileApplyResult> {
  const limit = options.maxMerges ?? plan.merges.length;
  const merges = plan.merges.slice(0, Math.max(0, limit));
  const outcomes: ReconcileMergeOutcome[] = [];
  let applied = 0;
  let failed = 0;

  for (const merge of merges) {
    const startedAt = performance.now();
    try {
      if (options.dryRun) {
        const moved = await countLoserChildren(db, merge.loserCanonicalEventId);
        outcomes.push({
          ...merge,
          status: "planned",
          durationMs: Math.round(performance.now() - startedAt),
          ...moved,
        });
      } else {
        const result = await applyEventMerge(db, merge);
        applied += 1;
        outcomes.push({
          ...merge,
          status: "applied",
          durationMs: Math.round(performance.now() - startedAt),
          ...result.moved,
        });
      }
    } catch (error) {
      failed += 1;
      outcomes.push({
        ...merge,
        status: "failed",
        durationMs: Math.round(performance.now() - startedAt),
        ...ZERO_MOVES,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { dryRun: options.dryRun, requested: merges.length, applied, failed, outcomes };
}
