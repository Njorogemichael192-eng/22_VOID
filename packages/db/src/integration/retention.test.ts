import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../generated/client/client.js";
import {
  applyRetention,
  createPrismaClient,
  persistCanonicalRun,
  type PersistCanonicalRunInput,
} from "../index.js";

// Retention deletes rows by age against a real clock, so these tests only mean
// anything against a real Postgres. They are skipped when DATABASE_URL is unset
// or unreachable, matching the other integration suites.
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

describe.skipIf(!dbAvailable)("retention integration", () => {
  let db: PrismaClient;

  const suffix = Date.now();
  const provider = `ret-test-${suffix}`;
  const canonicalEventId = `${provider}:evt-1`;
  const bookmakerName = `RetBook-${suffix}`;
  const runIdPrefix = `ret-test-run-${suffix}`;

  /** Reference instant; old rows sit well before the cutoff, new rows well after. */
  const NOW = new Date("2026-10-04T00:00:00.000Z");
  // Deliberately far in the past: it has to fall outside *every* default window
  // (7d raw, 30d health, 90d observations), not just the shortest one.
  const OLD = new Date("2025-01-01T00:00:00.000Z");
  const RECENT = new Date("2026-10-03T00:00:00.000Z");

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
        observedAt: RECENT.toISOString(),
      },
    ],
  };

  async function cleanup(client: PrismaClient): Promise<void> {
    const eventWhere = { canonicalEventId: { startsWith: "ret-test-" } };
    await client.auditLog
      .deleteMany({ where: { entityId: { startsWith: "ret-test-" } } })
      .catch(() => undefined);
    await client.scannerHealth
      .deleteMany({ where: { runId: { startsWith: "ret-test-run-" } } })
      .catch(() => undefined);
    await client.rawPayload
      .deleteMany({ where: { oddsSource: { key: { startsWith: "ret-test-" } } } })
      .catch(() => undefined);
    await client.selection
      .deleteMany({ where: { bookmaker: { name: { startsWith: "RetBook-" } } } })
      .catch(() => undefined);
    await client.bookmaker
      .deleteMany({ where: { name: { startsWith: "RetBook-" } } })
      .catch(() => undefined);
    await client.market
      .deleteMany({ where: { oddsSource: { key: { startsWith: "ret-test-" } } } })
      .catch(() => undefined);
    await client.sourceEventId.deleteMany({ where: { event: eventWhere } }).catch(() => undefined);
    await client.event.deleteMany({ where: eventWhere }).catch(() => undefined);
    await client.oddsSource
      .deleteMany({ where: { key: { startsWith: "ret-test-" } } })
      .catch(() => undefined);
  }

  /**
   * Removes only the telemetry rows a single test seeds. The event/market/
   * selection scaffolding is created once in beforeAll, so the per-test reset
   * must not delete it — otherwise the second test has no selection to write to.
   */
  async function resetTelemetry(
    client: PrismaClient,
    oddsSourceId: string,
    selectionId?: string
  ): Promise<void> {
    await client.rawPayload.deleteMany({ where: { oddsSourceId } });
    await client.scannerHealth.deleteMany({ where: { runId: { startsWith: runIdPrefix } } });
    if (selectionId !== undefined) {
      await client.oddsObservation.deleteMany({ where: { selectionId } });
    }
    await client.auditLog.deleteMany({ where: { entityId: { startsWith: provider } } });
  }

  /** One old + one recent row per table, so every prune must keep the recent one. */
  async function seed(client: PrismaClient, selectionId: string, oddsSourceId: string) {
    await client.rawPayload.createMany({
      data: [
        { oddsSourceId, payload: { tag: "old" }, receivedAt: OLD },
        { oddsSourceId, payload: { tag: "recent" }, receivedAt: RECENT },
      ],
    });
    await client.scannerHealth.createMany({
      data: [
        { runId: `${runIdPrefix}-old`, status: "HEALTHY", startedAt: OLD },
        { runId: `${runIdPrefix}-recent`, status: "HEALTHY", startedAt: RECENT },
      ],
    });
    await client.oddsObservation.createMany({
      data: [
        { selectionId, odds: "2.10", observedAt: OLD },
        { selectionId, odds: "2.20", observedAt: RECENT },
      ],
    });
    await client.auditLog.createMany({
      data: [
        { action: "retention.test.old", entityId: `${provider}:old`, createdAt: OLD },
        { action: "retention.test.recent", entityId: `${provider}:recent`, createdAt: RECENT },
      ],
    });
  }

  async function countRows(client: PrismaClient, selectionId: string, oddsSourceId: string) {
    const [raw, health, obs, audit] = await Promise.all([
      client.rawPayload.count({ where: { oddsSourceId } }),
      client.scannerHealth.count({ where: { runId: { startsWith: runIdPrefix } } }),
      client.oddsObservation.count({ where: { selectionId } }),
      client.auditLog.count({ where: { entityId: { startsWith: provider } } }),
    ]);
    return { raw, health, obs, audit };
  }

  beforeAll(async () => {
    db = createPrismaClient(process.env.DATABASE_URL!);
    await cleanup(db);
    await persistCanonicalRun(db, runInput);
  });

  afterAll(async () => {
    try {
      await cleanup(db);
    } catch {
      // teardown must never mask a real assertion failure
    }
    await db.$disconnect();
  });

  it("keeps everything under a dry run", async () => {
    const source = await db.oddsSource.findFirstOrThrow({ where: { key: provider } });
    const selection = await db.selection.findFirstOrThrow({
      where: { bookmaker: { name: bookmakerName } },
    });
    await resetTelemetry(db, source.id, selection.id);
    await seed(db, selection.id, source.id);

    const report = await applyRetention(db, { now: NOW, dryRun: true });

    const rows = await countRows(db, selection.id, source.id);
    expect(rows.raw).toBe(2);
    expect(rows.health).toBe(2);
    expect(rows.obs).toBe(2);
    expect(report.totalDeleted).toBe(0);
    // Every non-audit table has exactly one eligible (old) row.
    expect(report.tables.find((row) => row.table === "raw_payloads")?.eligible).toBe(1);
  });

  it("deletes only rows past the cutoff and leaves recent rows intact", async () => {
    const source = await db.oddsSource.findFirstOrThrow({ where: { key: provider } });
    const selection = await db.selection.findFirstOrThrow({
      where: { bookmaker: { name: bookmakerName } },
    });
    await resetTelemetry(db, source.id, selection.id);
    await seed(db, selection.id, source.id);

    const report = await applyRetention(db, { now: NOW });

    const rows = await countRows(db, selection.id, source.id);
    expect(rows.raw).toBe(1);
    expect(rows.health).toBe(1);
    expect(rows.obs).toBe(1);
    // audit_logs is disabled by default, so both of its rows survive.
    expect(rows.audit).toBe(2);
    expect(report.totalDeleted).toBe(3);
    expect(report.stillPending).toBe(false);

    const survivors = await Promise.all([
      db.rawPayload.findFirst({ where: { oddsSourceId: source.id } }),
      db.scannerHealth.findFirst({ where: { runId: { startsWith: runIdPrefix } } }),
      db.oddsObservation.findFirst({ where: { selectionId: selection.id } }),
    ]);
    expect(survivors[0]?.receivedAt.toISOString()).toBe(RECENT.toISOString());
    expect(survivors[1]?.startedAt.toISOString()).toBe(RECENT.toISOString());
    expect(survivors[2]?.observedAt.toISOString()).toBe(RECENT.toISOString());
  });

  it("prunes audit_logs only when an operator opts in", async () => {
    const source = await db.oddsSource.findFirstOrThrow({ where: { key: provider } });
    const selection = await db.selection.findFirstOrThrow({
      where: { bookmaker: { name: bookmakerName } },
    });
    await resetTelemetry(db, source.id, selection.id);
    await seed(db, selection.id, source.id);

    await applyRetention(db, { now: NOW, policy: { auditLogDays: 365 } });

    const rows = await countRows(db, selection.id, source.id);
    expect(rows.audit).toBe(1);
  });

  it("drains a backlog across batches and reports when work remains", async () => {
    const source = await db.oddsSource.findFirstOrThrow({ where: { key: provider } });
    await resetTelemetry(db, source.id);
    await db.rawPayload.createMany({
      data: Array.from({ length: 5 }, (_unused, index) => ({
        oddsSourceId: source.id,
        payload: { tag: `old-${index}` },
        receivedAt: OLD,
      })),
    });

    // batchSize 2 x maxBatches 1 can only remove 2 of the 5 eligible rows.
    const first = await applyRetention(db, {
      now: NOW,
      batchSize: 2,
      maxBatches: 1,
      tables: ["raw_payloads"],
    });
    expect(first.totalDeleted).toBe(2);
    expect(first.tables[0]?.exhausted).toBe(true);
    expect(first.stillPending).toBe(true);
    expect(first.tables[0]?.eligible).toBe(3);

    const remaining = await db.rawPayload.count({ where: { oddsSourceId: source.id } });
    expect(remaining).toBe(3);

    // A second run resumes rather than restarting or double-counting.
    const second = await applyRetention(db, {
      now: NOW,
      batchSize: 2,
      maxBatches: 1,
      tables: ["raw_payloads"],
    });
    expect(second.totalDeleted).toBe(2);
    expect(await db.rawPayload.count({ where: { oddsSourceId: source.id } })).toBe(1);
  });

  it("is idempotent when nothing is old enough to prune", async () => {
    const source = await db.oddsSource.findFirstOrThrow({ where: { key: provider } });
    await resetTelemetry(db, source.id);
    await db.rawPayload.createMany({
      data: [{ oddsSourceId: source.id, payload: { tag: "recent" }, receivedAt: RECENT }],
    });

    const first = await applyRetention(db, { now: NOW, tables: ["raw_payloads"] });
    const second = await applyRetention(db, { now: NOW, tables: ["raw_payloads"] });
    expect(first.totalDeleted).toBe(0);
    expect(second.totalDeleted).toBe(0);
    expect(await db.rawPayload.count({ where: { oddsSourceId: source.id } })).toBe(1);
  });
});
