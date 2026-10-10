import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "../index.js";
import {
  applyReconcilePlan,
  loadReconcileEvents,
  type ReconcilePlanInput,
} from "../event-reconcile.js";
import { persistCanonicalRun, type PersistCanonicalRunInput } from "../store.js";

/**
 * Phase 19 Step 4 — cross-provider event reconciliation integration tests.
 *
 * Same skip-if-unreachable convention as store.test.ts: plain `npm test` stays
 * green without a database; the CI db-integration job exercises it for real.
 */

async function isDatabaseReachable(url: string | undefined): Promise<boolean> {
  if (!url) return false;
  const probe = createPrismaClient(url);
  try {
    await probe.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await probe.$disconnect().catch(() => undefined);
  }
}

const dbAvailable = (await isDatabaseReachable(process.env.DATABASE_URL)) || false;

describe.skipIf(!dbAvailable)("Phase 19 - event reconciliation integration", () => {
  let db: PrismaClient;

  const suffix = Date.now();
  const providerA = `int-rec-${suffix}-a`;
  const providerB = `int-rec-${suffix}-b`;
  const eventA = `${providerA}:evt`;
  const eventB = `${providerB}:evt`;

  function runInput(
    provider: string,
    canonicalEventId: string,
    home: string,
    away: string,
    bookmaker: string
  ): PersistCanonicalRunInput {
    return {
      provider,
      events: [
        {
          canonicalEventId,
          competition: "Premier League",
          homeTeam: home,
          awayTeam: away,
          startTime: "2026-10-10T11:30:00.000Z",
          status: "SCHEDULED",
          sources: [{ provider, sourceEventId: canonicalEventId, eventConfidence: 0.95 }],
        },
      ],
      markets: [
        {
          provider,
          sourceMarketId: "mkt-1",
          eventCanonicalId: canonicalEventId,
          family: "MATCH_TOTAL",
          marketType: "spread",
          period: "FULL_MATCH",
          line: "2.5",
        },
      ],
      selections: [
        {
          provider,
          sourceMarketId: "mkt-1",
          bookmaker,
          outcome: "OVER",
          odds: 2.1,
          observedAt: "2026-10-06T10:00:00.000Z",
        },
      ],
    };
  }

  async function cleanup(client: PrismaClient): Promise<void> {
    const eventWhere = { canonicalEventId: { startsWith: "int-rec-" } };
    await client.market.deleteMany({ where: { event: eventWhere } });
    await client.sourceEventId.deleteMany({ where: { event: eventWhere } });
    await client.event.deleteMany({ where: eventWhere });
    await client.settlementRule.deleteMany({
      where: { oddsSource: { key: { startsWith: "int-rec-" } } },
    });
    await client.oddsSource.deleteMany({ where: { key: { startsWith: "int-rec-" } } });
    await client.bookmaker.deleteMany({ where: { name: { startsWith: "int-rec-" } } });
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    db = createPrismaClient(process.env.DATABASE_URL);
    await cleanup(db);
    await persistCanonicalRun(
      db,
      runInput(providerA, eventA, "Arsenal", "Leeds United", `int-rec-bk-a`)
    );
    await persistCanonicalRun(
      db,
      runInput(providerB, eventB, "Arsenal", "Leeds United FC", `int-rec-bk-b`)
    );
  });

  afterAll(async () => {
    await cleanup(db);
    await db.$disconnect();
  });

  it("loads persisted events with their provider bindings", async () => {
    const events = await loadReconcileEvents(db);
    const a = events.find((event) => event.canonicalEventId === eventA);
    const b = events.find((event) => event.canonicalEventId === eventB);
    expect(a?.sources).toEqual([
      { provider: providerA, sourceEventId: eventA, eventConfidence: 0.95 },
    ]);
    expect(b?.sources[0]?.provider).toBe(providerB);
  });

  it("dry-run counts what would move without writing", async () => {
    const plan: ReconcilePlanInput = {
      merges: [{ winnerCanonicalEventId: eventA, loserCanonicalEventId: eventB }],
    };
    const result = await applyReconcilePlan(db, plan, { dryRun: true });
    expect(result.applied).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.outcomes[0]).toMatchObject({ status: "planned", sourceEventIds: 1, markets: 1 });

    const events = await loadReconcileEvents(db);
    expect(events.some((event) => event.canonicalEventId === eventB)).toBe(true);
  });

  it("applies a fold: repoints children, deletes the loser, preserves row counts", async () => {
    const selectionsBefore = await db.selection.count({
      where: { market: { event: { canonicalEventId: eventA } } },
    });
    const plan: ReconcilePlanInput = {
      merges: [{ winnerCanonicalEventId: eventA, loserCanonicalEventId: eventB }],
    };
    const result = await applyReconcilePlan(db, plan, { dryRun: false });
    expect(result.applied).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.outcomes[0]).toMatchObject({ status: "applied", sourceEventIds: 1, markets: 1 });

    expect(await db.event.count({ where: { canonicalEventId: eventB } })).toBe(0);
    const bindings = await db.sourceEventId.count({
      where: { event: { canonicalEventId: eventA } },
    });
    expect(bindings).toBe(2);
    const markets = await db.market.count({ where: { event: { canonicalEventId: eventA } } });
    expect(markets).toBe(2);
    const selectionsAfter = await db.selection.count({
      where: { market: { event: { canonicalEventId: eventA } } },
    });
    expect(selectionsAfter).toBe(selectionsBefore + 1);
  });

  it("re-planning after a fold proposes nothing (resumable/idempotent)", async () => {
    const events = await loadReconcileEvents(db);
    expect(events.filter((event) => event.canonicalEventId === eventA)[0]?.sources).toHaveLength(2);
    expect(events.some((event) => event.canonicalEventId === eventB)).toBe(false);
  });

  it("records a failed merge for an already-absent loser without corrupting state", async () => {
    const plan: ReconcilePlanInput = {
      merges: [{ winnerCanonicalEventId: eventA, loserCanonicalEventId: eventB }],
    };
    const result = await applyReconcilePlan(db, plan, { dryRun: false });
    expect(result.failed).toBe(1);
    expect(result.outcomes[0]?.status).toBe("failed");
    expect(await db.event.count({ where: { canonicalEventId: eventA } })).toBe(1);
    expect(await db.market.count({ where: { event: { canonicalEventId: eventA } } })).toBe(2);
  });
});
