import { marketStructureKey } from "@22void/domain";
import type {
  MarketFamily,
  MarketStructure,
  MarketType,
  Participant,
  Period,
} from "@22void/domain";

/**
 * Cross-provider market reconciliation planner (Phase 19 Step 5).
 *
 * The runtime persist path keys a market by its canonical within-event
 * structure identity `(eventId, canonicalMarketId)`, so two providers' listings
 * of the *same* market structure fold into one Market row while their original
 * identities live on in market_source_ids. This planner repairs historical
 * state created before that key existed: given every persisted market, it
 * computes a deterministic set of within-event folds onto the canonical market.
 *
 * It is pure — no database, no I/O — so it can be unit tested and dry-run
 * without touching production. The transactional apply lives in @22void/db and
 * the CLI composes the two.
 *
 * Rules:
 *  - Markets are grouped by `(canonicalEventId, canonicalMarketId)`, where the
 *    canonical id is the structural identity family|period|marketType|
 *    participant|line (`marketStructureKey`, spec §7). Only identical structures
 *    are ever folded; nothing is inferred from labels.
 *  - The winner is chosen deterministically (provider priority, then earliest
 *    creation, then market id) so `odds-api` markets survive.
 *  - A group of one is standalone; every non-winner folds into the group's
 *    original winner (no chained re-pointing). The result is stable under input
 *    permutation.
 */

export interface ReconcileMarketRef {
  /** Persisted Market row id. */
  marketId: string;
  canonicalEventId: string;
  provider: string;
  /** The provider's canonical market identity (`${providerEventId}:${sourceMarketId}`). */
  sourceMarketId: string;
  family: string;
  period: string;
  marketType: string;
  participant?: string | null;
  line?: string | null;
  /** ISO creation time; used only to break winner ties deterministically. */
  createdAt?: string;
}

export interface ReconcileMarketMerge {
  winnerMarketId: string;
  loserMarketId: string;
  canonicalEventId: string;
  canonicalMarketId: string;
  winnerProvider: string;
  loserProvider: string;
  /** The loser's source identities, i.e. exactly what will move onto the winner. */
  sourceMarketIds: string[];
}

export interface ReconcileMarketPlan {
  merges: ReconcileMarketMerge[];
  /** Market ids that end up in a group of their own (nothing folded into them). */
  standalone: string[];
}

export interface ReconcileMarketOptions {
  /** Lower index wins. Defaults to `["odds-api", "parlay-api"]`. */
  providerPriority?: readonly string[];
}

export const DEFAULT_MARKET_PROVIDER_PRIORITY: readonly string[] = ["odds-api", "parlay-api"];

function providerRank(provider: string, priority: readonly string[]): number {
  const index = priority.indexOf(provider);
  return index >= 0 ? index : priority.length;
}

function compareMarkets(
  a: ReconcileMarketRef,
  b: ReconcileMarketRef,
  priority: readonly string[]
): number {
  const rank = providerRank(a.provider, priority) - providerRank(b.provider, priority);
  if (rank !== 0) return rank;
  const createdA = a.createdAt ?? "";
  const createdB = b.createdAt ?? "";
  if (createdA !== createdB) return createdA < createdB ? -1 : 1;
  return a.marketId < b.marketId ? -1 : a.marketId > b.marketId ? 1 : 0;
}

/** Canonical within-event market identity of a persisted market ref. */
export function marketRefKey(market: ReconcileMarketRef): string {
  return marketStructureKey({
    family: market.family as MarketFamily,
    period: market.period as Period,
    marketType: market.marketType as MarketType,
    participant: (market.participant ?? undefined) as Participant | undefined,
    line: market.line ?? undefined,
  } satisfies Pick<MarketStructure, "family" | "period" | "marketType" | "participant" | "line">);
}

function groupKey(market: ReconcileMarketRef): string {
  return `${market.canonicalEventId}\u0000${marketRefKey(market)}`;
}

/**
 * Compute the merge plan for a set of persisted markets.
 *
 * Markets are grouped by canonical event + canonical structure, then visited in
 * winner order so a fold always lands on the group's original winner. The result
 * is stable under input permutation.
 */
export function planMarketReconcile(
  markets: readonly ReconcileMarketRef[],
  options: ReconcileMarketOptions = {}
): ReconcileMarketPlan {
  const priority = options.providerPriority ?? DEFAULT_MARKET_PROVIDER_PRIORITY;

  const groups = new Map<string, ReconcileMarketRef[]>();
  for (const market of markets) {
    const key = groupKey(market);
    const members = groups.get(key);
    if (members === undefined) groups.set(key, [market]);
    else members.push(market);
  }

  const merges: ReconcileMarketMerge[] = [];
  const standalone: string[] = [];

  for (const members of groups.values()) {
    const ordered = [...members].sort((a, b) => compareMarkets(a, b, priority));
    const winner = ordered[0];
    if (winner === undefined) continue;
    if (ordered.length === 1) {
      standalone.push(winner.marketId);
      continue;
    }
    const canonicalMarketId = marketRefKey(winner);
    for (const loser of ordered.slice(1)) {
      merges.push({
        winnerMarketId: winner.marketId,
        loserMarketId: loser.marketId,
        canonicalEventId: winner.canonicalEventId,
        canonicalMarketId,
        winnerProvider: winner.provider,
        loserProvider: loser.provider,
        sourceMarketIds: [loser.sourceMarketId],
      });
    }
  }

  return { merges, standalone };
}
