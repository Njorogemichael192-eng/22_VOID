import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "../index.js";
import {
  loadPricedSelections,
  markSourceStatus,
  persistCanonicalRun,
  persistOpportunity,
  recordHeartbeat,
  toSelectionOutcomeType,
  type PersistCanonicalRunInput,
} from "../store.js";

/**
 * Phase 14 write-side store integration tests.
 *
 * Same skip-if-unreachable convention as crud.test.ts: plain `npm test` stays
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

describe.skipIf(!dbAvailable)("Phase 14 - scan worker store integration", () => {
  let db: PrismaClient;

  const suffix = Date.now();
  const provider = `int-test-${suffix}`;
  const canonicalEventId = `${provider}:evt-1`;
  const bookmakerName = `IntBook-${suffix}`;

  const runInput: PersistCanonicalRunInput = {
    provider,
    events: [
      {
        canonicalEventId,
        competition: "Premier League",
        homeTeam: "Alpha FC",
        awayTeam: "Beta FC",
        startTime: "2026-10-01T15:00:00.000Z",
        status: "SCHEDULED",
        sources: [{ provider, sourceEventId: "evt-1", eventConfidence: 0.95 }],
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
        bookmaker: bookmakerName,
        outcome: "OVER",
        odds: 2.1,
        observedAt: "2026-09-23T10:00:00.000Z",
        sourceUpdatedAt: "2026-09-23T09:59:00.000Z",
      },
    ],
  };

  /**
   * Deletes everything this suite may have created — in this run or in an
   * earlier aborted run — keyed by the `int-`/`run-` prefixes the suite owns.
   * Runs both before and after the suite so the shared dev database stays
   * clean and the Phase 15 history suite's global queries never see leftovers.
   */
  async function cleanupStoreData(client: PrismaClient): Promise<void> {
    const eventWhere = { canonicalEventId: { startsWith: "int-test-" } };
    await client.auditLog.deleteMany({ where: { opportunity: { event: eventWhere } } });
    await client.opportunityEpisode.deleteMany({
      where: {
        OR: [
          { id: { startsWith: "episode:int-test-" } },
          { id: { startsWith: "episode:hist-test-" } },
        ],
      },
    });
    await client.opportunity.deleteMany({ where: { event: eventWhere } });
    await client.selection.deleteMany({
      where: { bookmaker: { name: { startsWith: "IntBook-" } } },
    });
    await client.bookmaker.deleteMany({ where: { name: { startsWith: "IntBook-" } } });
    await client.market.deleteMany({ where: { oddsSource: { key: { startsWith: "int-test-" } } } });
    await client.sourceEventId.deleteMany({ where: { event: eventWhere } });
    await client.settlementRule.deleteMany({
      where: { oddsSource: { key: { startsWith: "int-test-" } } },
    });
    await client.rawPayload.deleteMany({ where: { oddsSource: { key: { startsWith: "int-test-" } } } });
    await client.event.deleteMany({ where: eventWhere });
    await client.oddsSource.deleteMany({ where: { key: { startsWith: "int-test-" } } });
    await client.scannerHealth.deleteMany({ where: { runId: { startsWith: "run-" } } });
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    db = createPrismaClient(process.env.DATABASE_URL);
    await cleanupStoreData(db);
  });

  afterAll(async () => {
    await cleanupStoreData(db);
    await db.$disconnect();
  });

  it("persists a canonical run idempotently", async () => {
    const first = await persistCanonicalRun(db, runInput);
    expect(first).toEqual({ events: 1, markets: 1, selections: 1, observations: 1, invalid: 0 });

    const second = await persistCanonicalRun(db, runInput);
    expect(second).toEqual({ events: 1, markets: 1, selections: 1, observations: 0, invalid: 0 });

    const events = await db.event.count({ where: { canonicalEventId } });
    const markets = await db.market.count({
      where: { oddsSource: { key: provider } },
    });
    const selections = await db.selection.count({
      where: { bookmaker: { name: bookmakerName } },
    });
    const observations = await db.oddsObservation.count({
      where: { selection: { bookmaker: { name: bookmakerName } } },
    });
    expect({ events, markets, selections, observations }).toEqual({
      events: 1,
      markets: 1,
      selections: 1,
      observations: 1,
    });

    const sourceEvent = await db.sourceEventId.findFirst({
      where: { oddsSource: { key: provider } },
    });
    expect(sourceEvent?.eventConfidence).toBe(0.95);
  });

  it("records an odds observation on the first quote and each price change", async () => {
    const moved = await persistCanonicalRun(db, {
      ...runInput,
      selections: [
        { ...runInput.selections[0]!, odds: 2.2, observedAt: "2026-09-23T10:05:00.000Z" },
      ],
    });
    expect(moved.observations).toBe(1);

    const selection = await db.selection.findFirstOrThrow({
      where: { bookmaker: { name: bookmakerName } },
    });
    expect(Number(selection.odds)).toBe(2.2);
    const observations = await db.oddsObservation.count({
      where: { selection: { bookmaker: { name: bookmakerName } } },
    });
    expect(observations).toBe(2);
  });

  it("counts unmappable outcomes as invalid instead of guessing", async () => {
    const exactScore: PersistCanonicalRunInput = {
      ...runInput,
      markets: [
        {
          provider,
          sourceMarketId: "mkt-2",
          eventCanonicalId: canonicalEventId,
          family: "EXACT_SCORE",
          marketType: "correct",
          period: "FULL_MATCH",
        },
      ],
      selections: [
        {
          provider,
          sourceMarketId: "mkt-2",
          bookmaker: bookmakerName,
          outcome: "2-1",
          odds: 7,
          observedAt: "2026-09-23T10:05:00.000Z",
        },
      ],
    };
    const result = await persistCanonicalRun(db, exactScore);
    expect(result.invalid).toBe(1);
    expect(result.selections).toBe(0);
    expect(toSelectionOutcomeType("2-1")).toBeNull();
    expect(toSelectionOutcomeType("OVER")).toBe("OVER");
  });

  it("loads priced selections for detection with attested provenance", async () => {
    await markSourceStatus(db, provider, "HEALTHY");
    const rows = await loadPricedSelections(db, { eventId: canonicalEventId });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.eventId).toBe(canonicalEventId);
    expect(row.family).toBe("MATCH_TOTAL");
    expect(row.period).toBe("FULL_MATCH");
    expect(row.line).toBe("2.5");
    expect(row.outcome).toBe("OVER");
    expect(row.odds).toBe(2.2);
    expect(row.bookmaker).toBe(bookmakerName);
    expect(row.provider).toBe(provider);
    expect(row.sourceStatus).toBe("OK");
    expect(row.eventConfidence).toBe(0.95);
    expect(row.sourceUpdatedAt).toBe("2026-09-23T09:59:00.000Z");
    expect(row.settlementRuleVersion).toBe("1");
    expect(row.settlementConfidence).toBe(1);
  });

  it("records heartbeats and persists opportunities with legs and audit trail", async () => {
    const heartbeat = await recordHeartbeat(db, {
      runId: `run-${suffix}-a`,
      status: "HEALTHY",
      message: "cycle ok",
    });
    expect(heartbeat.status).toBe("HEALTHY");
    expect(heartbeat.message).toBe("cycle ok");
    expect(heartbeat.finishedAt).toBeNull();

    const priced = await loadPricedSelections(db, { eventId: canonicalEventId });
    const selectionId = priced[0]!.id;
    await persistOpportunity(db, {
      id: `opp-${suffix}`,
      eventCanonicalId: canonicalEventId,
      status: "VERIFIED_ARB",
      marketStructure: "SAME_MARKET_COMPLEMENT",
      totalStake: 100,
      minReturn: 101.5,
      guaranteedProfit: 1.5,
      roi: 0.015,
      engineVersion: "1",
      detectedAt: "2026-09-23T10:06:00.000Z",
      legs: [
        { selectionId, oddsSnapshot: 2.2, stake: 50, guaranteedReturn: 110 },
      ],
      audit: [{ action: "OPPORTUNITY_CREATED", actor: provider }],
    });

    const opportunity = await db.opportunity.findUniqueOrThrow({
      where: { id: `opp-${suffix}` },
      include: { legs: true, auditLogs: true },
    });
    expect(opportunity.status).toBe("VERIFIED_ARB");
    expect(opportunity.legs).toHaveLength(1);
    expect(opportunity.auditLogs).toHaveLength(1);
    expect(opportunity.auditLogs[0]!.action).toBe("OPPORTUNITY_CREATED");
  });
});