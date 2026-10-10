/**
 * @22void/db — cross-provider market reconciliation applier (Phase 19 Step 5).
 *
 * This module reads the stored markets for the pure planner
 * (`planMarketReconcile` in @22void/normalization) and performs the folds
 * transactionally. It imports only Prisma types plus the local provider-priority
 * helper so the persistence layer stays independent of the normalization and
 * worker packages (docs/ARCHITECTURE.md).
 *
 * A fold moves every child of the loser market onto the winner — its
 * market_source_ids (each provider's original identity) and its selections — and
 * then deletes the loser row. A selection that collides with an existing winner
 * selection on `(bookmaker, outcome)` is dropped in favour of the winner's
 * (higher-priority provider); a conflicting selection that is already referenced
 * by an opportunity leg is left in place and the merge fails loudly rather than
 * breaking the audit trail.
 *
 * One transaction per merge: partial progress is intended — a failure on pair N
 * leaves pairs 1..N-1 committed, and because the loser's sources have already
 * moved, re-planning no longer proposes them, so a re-run resumes cleanly.
 */

import type { Prisma, PrismaClient } from "./generated/client/client";
import { providerRank } from "./store";

export type DbClient = PrismaClient;
type Tx = Prisma.TransactionClient;

const MERGE_TRANSACTION_TIMEOUT_MS = 30_000;
const MERGE_TRANSACTION_MAX_WAIT_MS = 10_000;

/** One persisted market, in the shape the planner consumes. */
export interface ReconcilableMarket {
  marketId: string;
  canonicalEventId: string;
  provider: string;
  sourceMarketId: string;
  family: string;
  period: string;
  marketType: string;
  participant: string | null;
  line: string | null;
  createdAt: string;
}

export interface ReconcileMarketMergeInput {
  winnerMarketId: string;
  loserMarketId: string;
}

export interface ReconcileMarketPlanInput {
  merges: readonly ReconcileMarketMergeInput[];
}

export interface MarketMoveCounts {
  marketSourceIds: number;
  selections: number;
  droppedSelections: number;
}

export interface ApplyMarketMergeResult {
  winnerMarketId: string;
  loserMarketId: string;
  moved: MarketMoveCounts;
}

export interface ReconcileMarketOutcome extends ReconcileMarketMergeInput, MarketMoveCounts {
  status: "planned" | "applied" | "failed";
  durationMs: number;
  error?: string;
}

export interface ReconcileMarketApplyResult {
  dryRun: boolean;
  requested: number;
  applied: number;
  failed: number;
  outcomes: ReconcileMarketOutcome[];
}

export interface ReconcileMarketApplyOptions {
  /** When true, count what would move but write nothing. */
  dryRun: boolean;
  /** Optional ceiling on merges processed this run. */
  maxMerges?: number;
}

const ZERO_MOVES: MarketMoveCounts = {
  marketSourceIds: 0,
  selections: 0,
  droppedSelections: 0,
};

/** Read every persisted market with its source identity. */
export async function loadReconcileMarkets(db: DbClient): Promise<ReconcilableMarket[]> {
  const rows = await db.market.findMany({
    include: {
      oddsSource: { select: { key: true } },
      event: { select: { canonicalEventId: true } },
    },
    orderBy: { id: "asc" },
  });

  return rows.map((row) => ({
    marketId: row.id,
    canonicalEventId: row.event.canonicalEventId,
    provider: row.oddsSource.key,
    sourceMarketId: row.sourceMarketId,
    family: row.family,
    period: row.period,
    marketType: row.marketType,
    participant: row.participant,
    line: row.line,
    createdAt: row.createdAt.toISOString(),
  }));
}

async function resolveMarketId(db: DbClient, marketId: string): Promise<string> {
  const row = await db.market.findUnique({ where: { id: marketId }, select: { id: true } });
  if (row === null) throw new Error(`market reconcile: unknown market ${marketId}`);
  return row.id;
}

/**
 * Point the winner's primary identity at its highest-priority contributing
 * source, so `Market.oddsSourceId` / `sourceMarketId` / `settlementRuleId` stay
 * meaningful after a fold brought in another provider's market.
 */
async function reassignMarketPrimary(tx: Tx, marketId: string): Promise<void> {
  const sources = await tx.marketSourceId.findMany({
    where: { marketId },
    include: { oddsSource: { select: { key: true } } },
  });
  if (sources.length === 0) return;
  let primary = sources[0]!;
  for (const candidate of sources) {
    if (providerRank(candidate.oddsSource.key) < providerRank(primary.oddsSource.key)) {
      primary = candidate;
    }
  }
  await tx.market.update({
    where: { id: marketId },
    data: {
      oddsSourceId: primary.oddsSourceId,
      sourceMarketId: primary.sourceMarketId,
      settlementRuleId: primary.settlementRuleId,
    },
  });
}

/**
 * Fold one loser market into a winner inside a single transaction. Throws if
 * either id is unknown or a conflicting selection is referenced by an
 * opportunity leg (the plan was built from a different state, or a real
 * conflict needs a human decision).
 */
export async function applyMarketMerge(
  db: DbClient,
  input: ReconcileMarketMergeInput
): Promise<ApplyMarketMergeResult> {
  const winnerId = await resolveMarketId(db, input.winnerMarketId);
  const loserId = await resolveMarketId(db, input.loserMarketId);
  if (winnerId === loserId) {
    throw new Error(
      `market reconcile: winner and loser are the same market ${input.winnerMarketId}`
    );
  }

  return db.$transaction(
    async (tx) => {
      const loserSelections = await tx.selection.findMany({
        where: { marketId: loserId },
        select: { id: true, bookmakerId: true, outcome: true },
      });
      const winnerSelections = await tx.selection.findMany({
        where: { marketId: winnerId },
        select: { bookmakerId: true, outcome: true },
      });
      const winnerKeys = new Set(
        winnerSelections.map((row) => `${row.bookmakerId}\u0000${row.outcome}`)
      );

      let droppedSelections = 0;
      for (const selection of loserSelections) {
        if (!winnerKeys.has(`${selection.bookmakerId}\u0000${selection.outcome}`)) continue;
        const legs = await tx.opportunityLeg.count({ where: { selectionId: selection.id } });
        if (legs > 0) {
          throw new Error(
            `market reconcile: selection ${selection.id} conflicts with the winner and is referenced by ${legs} opportunity leg(s)`
          );
        }
        await tx.selection.delete({ where: { id: selection.id } });
        droppedSelections += 1;
      }

      const movedSelections = (
        await tx.selection.updateMany({
          where: { marketId: loserId },
          data: { marketId: winnerId },
        })
      ).count;
      const marketSourceIds = (
        await tx.marketSourceId.updateMany({
          where: { marketId: loserId },
          data: { marketId: winnerId },
        })
      ).count;
      await reassignMarketPrimary(tx, winnerId);
      await tx.market.delete({ where: { id: loserId } });

      return {
        winnerMarketId: winnerId,
        loserMarketId: loserId,
        moved: { marketSourceIds, selections: movedSelections, droppedSelections },
      };
    },
    { timeout: MERGE_TRANSACTION_TIMEOUT_MS, maxWait: MERGE_TRANSACTION_MAX_WAIT_MS }
  );
}

async function countLoserChildren(db: DbClient, loserMarketId: string): Promise<MarketMoveCounts> {
  const loserId = await resolveMarketId(db, loserMarketId);
  const [marketSourceIds, selections] = await Promise.all([
    db.marketSourceId.count({ where: { marketId: loserId } }),
    db.selection.count({ where: { marketId: loserId } }),
  ]);
  return { marketSourceIds, selections, droppedSelections: 0 };
}

/**
 * Execute (or dry-run) a plan merge by merge. Never throws on a single failed
 * merge — the outcome is recorded and the run continues.
 */
export async function applyMarketReconcilePlan(
  db: DbClient,
  plan: ReconcileMarketPlanInput,
  options: ReconcileMarketApplyOptions
): Promise<ReconcileMarketApplyResult> {
  const limit = options.maxMerges ?? plan.merges.length;
  const merges = plan.merges.slice(0, Math.max(0, limit));
  const outcomes: ReconcileMarketOutcome[] = [];
  let applied = 0;
  let failed = 0;

  for (const merge of merges) {
    const startedAt = performance.now();
    try {
      if (options.dryRun) {
        const moved = await countLoserChildren(db, merge.loserMarketId);
        outcomes.push({
          ...merge,
          status: "planned",
          durationMs: Math.round(performance.now() - startedAt),
          ...moved,
        });
      } else {
        const result = await applyMarketMerge(db, merge);
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
