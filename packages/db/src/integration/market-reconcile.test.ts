import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "../index.js";
import {
  applyMarketMerge,
  applyMarketReconcilePlan,
  loadReconcileMarkets,
} from "../market-reconcile.js";
import {
  loadPricedSelections,
  persistCanonicalRun,
  type PersistCanonicalRunInput,
} from "../store.js";

/**
 * Phase 19 Step 5 — cross-provider market reconciliation integration tests.
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

const CANONICAL_MARKET_ID = "MATCH_TOTAL|FULL_MATCH|STANDARD|_|2.5";

describe.skipIf(!dbAvailable)("Phase 19 - market reconciliation integration", () => {
  let db: PrismaClient;

  const suffix = Date.now();
  const providerA = `int-mkt-${suffix}-a`;
  const providerB = `int-mkt-${suffix}-b`;
  const providerLegacy = `int-mkt-${suffix}-legacy`;
  const canonicalEventId = `${providerA}:evt`;
  const bookA = `IntMktBook-a-${suffix}`;
  const bookB = `IntMktBook-b-${suffix}`;
  const bookLegacy = `IntMktBook-legacy-${suffix}`;

  function runInput(provider: string, bookmaker: string, odds: number): PersistCanonicalRunInput {
    return {
      provider,
      events: [
        {
          canonicalEventId,
          competition: "Premier League",
          homeTeam: "Arsenal",
          awayTeam: "Leeds United",
          startTime: "2026-10-10T11:30:00.000Z",
          status: "SCHEDULED",
          sources: [{ provider, sourceEventId: "evt", eventConfidence: 0.95 }],
        },
      ],
      markets: [
        {
          provider,
          sourceMarketId: `${provider}:mkt-1`,
          eventCanonicalId: canonicalEventId,
          family: "MATCH_TOTAL",
          marketType: "STANDARD",
          period: "FULL_MATCH",
          line: "2.5",
        },
      ],
      selections: [
        {
          provider,
          sourceMarketId: `${provider}:mkt-1`,
          bookmaker,
          outcome: "OVER",
          odds,
          observedAt: "2026-10-06T10:00:00.000Z",
          sourceUpdatedAt: "2026-10-06T09:59:00.000Z",
        },
      ],
    };
  }

  async function cleanup(client: PrismaClient): Promise<void> {
    const eventWhere = { canonicalEventId: { startsWith: "int-mkt-" } };
    await client.opportunity.deleteMany({ where: { event: eventWhere } });
    await client.market.deleteMany({ where: { event: eventWhere } });
    await client.sourceEventId.deleteMany({ where: { event: eventWhere } });
    await client.settlementRule.deleteMany({
      where: { oddsSource: { key: { startsWith: "int-mkt-" } } },
    });
    await client.oddsSource.deleteMany({ where: { key: { startsWith: "int-mkt-" } } });
    await client.bookmaker.deleteMany({ where: { name: { startsWith: "IntMktBook-" } } });
    await client.event.deleteMany({ where: eventWhere });
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    db = createPrismaClient(process.env.DATABASE_URL);
    await cleanup(db);
  });

  afterAll(async () => {
    await cleanup(db);
    await db.$disconnect();
  });

  it("folds two providers' identical markets into one row with per-selection provenance", async () => {
    await persistCanonicalRun(db, runInput(providerA, bookA, 2.1));
    await persistCanonicalRun(db, runInput(providerB, bookB, 2.15));

    const event = await db.event.findUniqueOrThrow({ where: { canonicalEventId } });
    const markets = await db.market.findMany({ where: { eventId: event.id } });
    expect(markets).toHaveLength(1);
    expect(markets[0]?.canonicalMarketId).toBe(CANONICAL_MARKET_ID);

    const sources = await db.marketSourceId.findMany({ where: { marketId: markets[0]!.id } });
    expect(sources).toHaveLength(2);

    const priced = await loadPricedSelections(db, { eventId: canonicalEventId });
    expect(priced).toHaveLength(2);
    const byProvider = new Map(priced.map((row) => [row.provider, row]));
    expect(byProvider.get(providerA)?.bookmaker).toBe(bookA);
    expect(byProvider.get(providerB)?.bookmaker).toBe(bookB);
    expect(byProvider.get(providerA)?.settlementRuleVersion).toBe("1");
    expect(byProvider.get(providerB)?.settlementRuleVersion).toBe("1");
  });

  it("loads persisted markets with their canonical identity for the planner", async () => {
    const markets = await loadReconcileMarkets(db);
    const ours = markets.filter((market) => market.canonicalEventId === canonicalEventId);
    expect(ours).toHaveLength(1);
    expect(ours[0]?.sourceMarketId).toBe(`${providerA}:mkt-1`);
  });

  it("moves a legacy duplicate's sources and selections onto the winner", async () => {
    const event = await db.event.findUniqueOrThrow({ where: { canonicalEventId } });
    const winner = await db.market.findFirstOrThrow({
      where: { eventId: event.id, canonicalMarketId: CANONICAL_MARKET_ID },
    });

    const legacySource = await db.oddsSource.create({
      data: { key: providerLegacy, displayName: "Legacy Market Source" },
    });
    const legacyRule = await db.settlementRule.create({
      data: {
        oddsSourceId: legacySource.id,
        family: "MATCH_TOTAL",
        marketType: "STANDARD",
        version: 1,
      },
    });
    const legacyMarket = await db.market.create({
      data: {
        eventId: event.id,
        oddsSourceId: legacySource.id,
        sourceMarketId: `${providerLegacy}:mkt-1`,
        settlementRuleId: legacyRule.id,
        canonicalMarketId: CANONICAL_MARKET_ID,
        family: "MATCH_TOTAL",
        marketType: "STANDARD",
        period: "FULL_MATCH",
        line: "2.5",
      },
    });
    const legacyMarketSource = await db.marketSourceId.create({
      data: {
        marketId: legacyMarket.id,
        oddsSourceId: legacySource.id,
        sourceMarketId: `${providerLegacy}:mkt-1`,
        settlementRuleId: legacyRule.id,
      },
    });
    const legacyBookmaker = await db.bookmaker.create({ data: { name: bookLegacy } });
    await db.selection.create({
      data: {
        marketId: legacyMarket.id,
        marketSourceId: legacyMarketSource.id,
        bookmakerId: legacyBookmaker.id,
        outcome: "OVER",
        odds: 2.2,
      },
    });

    const result = await applyMarketMerge(db, {
      winnerMarketId: winner.id,
      loserMarketId: legacyMarket.id,
    });
    expect(result.moved).toMatchObject({ marketSourceIds: 1, selections: 1, droppedSelections: 0 });

    expect(await db.market.count({ where: { id: legacyMarket.id } })).toBe(0);
    const sources = await db.marketSourceId.findMany({ where: { marketId: winner.id } });
    expect(sources.map((row) => row.sourceMarketId).sort()).toEqual(
      [`${providerA}:mkt-1`, `${providerB}:mkt-1`, `${providerLegacy}:mkt-1`].sort()
    );

    const priced = await loadPricedSelections(db, { eventId: canonicalEventId });
    expect(priced).toHaveLength(3);
    expect(priced.find((row) => row.provider === providerLegacy)?.bookmaker).toBe(bookLegacy);
  });

  it("drops a colliding legacy selection, keeping the winner's provenance", async () => {
    const event = await db.event.findUniqueOrThrow({ where: { canonicalEventId } });
    const winner = await db.market.findFirstOrThrow({
      where: { eventId: event.id, canonicalMarketId: CANONICAL_MARKET_ID },
    });

    // Second legacy market re-using bookA/OVER, which the winner already has.
    const source = await db.oddsSource.create({
      data: { key: `${providerLegacy}-dup`, displayName: "Legacy Duplicate" },
    });
    const rule = await db.settlementRule.create({
      data: {
        oddsSourceId: source.id,
        family: "MATCH_TOTAL",
        marketType: "STANDARD",
        version: 1,
      },
    });
    const market = await db.market.create({
      data: {
        eventId: event.id,
        oddsSourceId: source.id,
        sourceMarketId: `${providerLegacy}-dup:mkt-1`,
        settlementRuleId: rule.id,
        canonicalMarketId: CANONICAL_MARKET_ID,
        family: "MATCH_TOTAL",
        marketType: "STANDARD",
        period: "FULL_MATCH",
        line: "2.5",
      },
    });
    const marketSource = await db.marketSourceId.create({
      data: {
        marketId: market.id,
        oddsSourceId: source.id,
        sourceMarketId: `${providerLegacy}-dup:mkt-1`,
        settlementRuleId: rule.id,
      },
    });
    const existingBookmaker = await db.bookmaker.findFirstOrThrow({ where: { name: bookA } });
    await db.selection.create({
      data: {
        marketId: market.id,
        marketSourceId: marketSource.id,
        bookmakerId: existingBookmaker.id,
        outcome: "OVER",
        odds: 9.99,
      },
    });

    const result = await applyMarketMerge(db, {
      winnerMarketId: winner.id,
      loserMarketId: market.id,
    });
    expect(result.moved).toMatchObject({ selections: 0, droppedSelections: 1 });

    const survivor = await db.selection.findFirstOrThrow({
      where: { marketId: winner.id, bookmakerId: existingBookmaker.id, outcome: "OVER" },
    });
    expect(Number(survivor.odds)).toBe(2.1);
  });

  it("records a failed merge for an already-absent loser without corrupting state", async () => {
    const result = await applyMarketReconcilePlan(
      db,
      { merges: [{ winnerMarketId: "missing-winner", loserMarketId: "missing-loser" }] },
      { dryRun: false }
    );
    expect(result.failed).toBe(1);
    expect(result.outcomes[0]?.status).toBe("failed");
  });
});
