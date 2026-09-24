import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "../index.js";
import {
  computeOpportunityKey,
  falsePositiveAnalysis,
  getEpisodeReconstruction,
  listOpportunityEpisodes,
  loadOddsHistory,
  persistCanonicalRun,
  persistOpportunity,
  recordHeartbeat,
  sourceLatencyStats,
  sweepOpportunityEpisodes,
  type PersistCanonicalRunInput,
} from "../index.js";

/**
 * Phase 15 history layer integration tests. Same skip-if-unreachable convention
 * as the Phase 14 store tests: plain `npm test` stays green without a database.
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

describe.skipIf(!dbAvailable)("Phase 15 - history integration", () => {
  let db: PrismaClient;

  const suffix = Date.now();
  const provider = `hist-test-${suffix}`;
  const canonicalEventId = `${provider}:evt-1`;
  const bookmakerName = `HistBook-${suffix}`;

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
      },
    ],
  };

  /**
   * Deletes everything this suite may have created — in this run or in an
   * earlier aborted run — keyed by the `hist-`/`run-` prefixes it owns. Also
   * clears opportunity_episodes and their audit trail, which the previous
   * cleanup skipped and which leaked into this suite's global queries.
   */
  async function cleanupHistoryData(client: PrismaClient): Promise<void> {
    const eventWhere = { canonicalEventId: { startsWith: "hist-test-" } };
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
    await client.scannerHealth.deleteMany({ where: { runId: { startsWith: "run-" } } });
    await client.selection.deleteMany({
      where: { bookmaker: { name: { startsWith: "HistBook-" } } },
    });
    await client.bookmaker.deleteMany({ where: { name: { startsWith: "HistBook-" } } });
    await client.market.deleteMany({
      where: { oddsSource: { key: { startsWith: "hist-test-" } } },
    });
    await client.sourceEventId.deleteMany({ where: { event: eventWhere } });
    await client.settlementRule.deleteMany({
      where: { oddsSource: { key: { startsWith: "hist-test-" } } },
    });
    await client.rawPayload.deleteMany({ where: { oddsSource: { key: { startsWith: "hist-test-" } } } });
    await client.event.deleteMany({ where: eventWhere });
    await client.oddsSource.deleteMany({ where: { key: { startsWith: "hist-test-" } } });
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    db = createPrismaClient(process.env.DATABASE_URL);
    await cleanupHistoryData(db);
  });

  afterAll(async () => {
    await cleanupHistoryData(db);
    await db.$disconnect();
  });

  it("tracks an episode across repeated detections of the same legs", async () => {
    await persistCanonicalRun(db, runInput);
    const priced = await db.selection.findFirstOrThrow({
      where: { bookmaker: { name: bookmakerName } },
      select: { id: true },
    });
    const selectionId = priced.id;
    const structureType = "SAME_MARKET_COMPLEMENT";
    const episodeKey = computeOpportunityKey({ eventCanonicalId: canonicalEventId, structureType, selectionIds: [selectionId] });

    await persistOpportunity(db, {
      eventCanonicalId: canonicalEventId,
      status: "VERIFIED_ARB",
      marketStructure: structureType,
      opportunityKey: episodeKey,
      totalStake: 100,
      minReturn: 101.5,
      guaranteedProfit: 1.5,
      roi: 0.015,
      engineVersion: "1",
      detectedAt: "2026-09-23T10:00:00.000Z",
      legs: [{ selectionId, oddsSnapshot: 2.1, stake: 50, guaranteedReturn: 105 }],
      audit: [{ action: "OPPORTUNITY_VALIDATED", actor: provider }],
    });
    await persistOpportunity(db, {
      eventCanonicalId: canonicalEventId,
      status: "VERIFIED_ARB",
      marketStructure: structureType,
      opportunityKey: episodeKey,
      totalStake: 100,
      minReturn: 101.8,
      guaranteedProfit: 1.8,
      roi: 0.018,
      engineVersion: "1",
      detectedAt: "2026-09-23T10:01:00.000Z",
      legs: [{ selectionId, oddsSnapshot: 2.2, stake: 50, guaranteedReturn: 110 }],
      audit: [{ action: "OPPORTUNITY_VALIDATED", actor: provider }],
    });

    const episodes = await listOpportunityEpisodes(db);
    expect(episodes).toHaveLength(1);
    expect(episodes[0]).toMatchObject({
      id: episodeKey,
      eventCanonicalId: canonicalEventId,
      structureType,
      status: "VERIFIED_ARB",
      detectedCount: 2,
      durationMs: 60000,
    });
    expect(episodes[0]?.disappearedAt).toBeNull();
  });

  it("records the full price series and reconstructs the episode", async () => {
    await persistCanonicalRun(db, {
      ...runInput,
      selections: [
        { ...runInput.selections[0]!, odds: 2.2, observedAt: "2026-09-23T10:01:00.000Z" },
      ],
    });

    const series = await loadOddsHistory(db, { eventCanonicalId: canonicalEventId });
    expect(series.map((point) => point.odds)).toEqual([2.1, 2.2]);
    expect(series[0]?.bookmaker).toBe(bookmakerName);

    const episodes = await listOpportunityEpisodes(db, { limit: 1 });
    const reconstruction = await getEpisodeReconstruction(db, episodes[0]!.id);
    expect(reconstruction).not.toBeNull();
    expect(reconstruction?.detections).toHaveLength(2);
    expect(reconstruction?.legs).toHaveLength(1);
    const leg = reconstruction?.legs[0];
    expect(leg?.snapshotOdds).toBe(2.1);
    expect(leg?.history.map((point) => point.odds)).toEqual([2.1, 2.2]);
    expect(leg?.movement).toMatchObject({ first: 2.1, last: 2.2, min: 2.1, max: 2.2 });
    expect(leg?.movement.delta).toBeCloseTo(0.1);
  });

  it("sweeps unseen episodes as disappeared and restores returning ones", async () => {
    const episode = await db.opportunityEpisode.findFirstOrThrow({ where: { event: { canonicalEventId } } });
    const swept = await sweepOpportunityEpisodes(db, ["some-other-episode"], new Date("2026-09-23T11:00:00.000Z"));
    expect(swept).toEqual({ disappeared: 1, restored: 0 });

    const hidden = await db.opportunityEpisode.findUniqueOrThrow({ where: { id: episode.id } });
    expect(hidden.disappearedAt?.toISOString()).toBe("2026-09-23T11:00:00.000Z");

    const restored = await sweepOpportunityEpisodes(db, [episode.id], new Date("2026-09-23T12:00:00.000Z"));
    expect(restored).toEqual({ disappeared: 0, restored: 1 });
    const visible = await db.opportunityEpisode.findUniqueOrThrow({ where: { id: episode.id } });
    expect(visible.disappearedAt).toBeNull();
  });

  it("aggregates source latency from completed scan cycles", async () => {
    const source = await db.oddsSource.findUniqueOrThrow({ where: { key: provider } });
    await recordHeartbeat(db, {
      runId: `run-${suffix}-h1`,
      oddsSourceId: source.id,
      status: "HEALTHY",
      startedAt: new Date("2026-09-23T10:00:00.000Z"),
      finishedAt: new Date("2026-09-23T10:00:05.000Z"),
    });
    await recordHeartbeat(db, {
      runId: `run-${suffix}-h2`,
      oddsSourceId: source.id,
      status: "HEALTHY",
      startedAt: new Date("2026-09-23T10:01:00.000Z"),
      finishedAt: new Date("2026-09-23T10:01:03.000Z"),
    });

    const stats = await sourceLatencyStats(db, { sourceKey: provider });
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({ sourceKey: provider, runs: 2, avgMs: 4000, minMs: 3000, maxMs: 5000 });
    expect(stats[0]?.lastRunAt).toBe("2026-09-23T10:01:00.000Z");
  });

  it("reports verified vs false-positive episodes with rejection reasons", async () => {
    const selectionId = (
      await db.selection.findFirstOrThrow({ where: { bookmaker: { name: bookmakerName } } })
    ).id;
    const staleKey = computeOpportunityKey({
      eventCanonicalId: canonicalEventId,
      structureType: "DIFFERENT_BOOKMAKER_MULTIWAY",
      selectionIds: [selectionId],
    });
    await persistOpportunity(db, {
      eventCanonicalId: canonicalEventId,
      status: "REJECTED",
      rejectionReason: "STALE_ODDS",
      marketStructure: "DIFFERENT_BOOKMAKER_MULTIWAY",
      opportunityKey: staleKey,
      engineVersion: "1",
      detectedAt: "2026-09-23T10:02:00.000Z",
      legs: [{ selectionId, oddsSnapshot: 1.9 }],
      audit: [{ action: "OPPORTUNITY_VALIDATED", actor: provider }],
    });

    const report = await falsePositiveAnalysis(db, { after: "2026-09-23T00:00:00.000Z" });
    expect(report.episodes).toBe(2);
    expect(report.verified).toBe(1);
    expect(report.falsePositives).toBe(1);
    expect(report.falsePositiveRate).toBe(0.5);
    expect(report.byStatus.find((entry) => entry.status === "REJECTED")?.count).toBe(1);
    expect(report.topRejectionReasons).toEqual([{ reason: "STALE_ODDS", count: 1 }]);
  });
});