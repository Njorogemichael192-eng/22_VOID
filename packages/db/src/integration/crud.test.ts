import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, Prisma, type PrismaClient } from "../index.js";

/**
 * Phase 1 CRUD integration tests.
 *
 * These run against a real PostgreSQL instance. When DATABASE_URL is unset or
 * unreachable the whole suite is skipped so plain `npm test` stays green in
 * environments without a database (CI's default job). The CI db-integration
 * job provides a Postgres service and a DATABASE_URL to actually exercise it,
 * per the Phase 1 acceptance criterion: "migrations and CRUD integration
 * tests pass".
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

describe.skipIf(!dbAvailable)("Phase 1 — database CRUD integration", () => {
  let db: PrismaClient;

  const suffix = `${Date.now()}`;
  const ids = {
    oddsSourceId: "",
    eventId: "",
    marketId: "",
    selectionId: "",
  };

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    db = createPrismaClient(process.env.DATABASE_URL);
  });

  afterAll(async () => {
    // Reverse dependency order so FK constraints stay satisfied. Rows are
    // matched by the unique keys we control (children of this run), not by
    // random cuid ids.
    const { oddsSourceId, eventId } = ids;

    await db.auditLog.deleteMany({
      where: { action: `OPPORTUNITY_CREATED op-${suffix}` },
    });
    await db.opportunity.deleteMany({ where: { id: `opp-${suffix}` } });
    await db.event.deleteMany({ where: { id: eventId } });
    await db.settlementRule.deleteMany({
      where: { oddsSourceId, family: "MATCH_TOTAL" },
    });
    await db.rawPayload.deleteMany({ where: { oddsSourceId } });
    await db.scannerHealth.deleteMany({ where: { runId: `run-${suffix}` } });
    await db.bookmaker.deleteMany({ where: { name: { contains: suffix } } });
    await db.teamAlias.deleteMany({ where: { alias: { contains: suffix } } });
    await db.team.deleteMany({ where: { name: { contains: suffix } } });
    await db.oddsSource.deleteMany({ where: { key: `src-${suffix}` } });
    await db.$disconnect();
  });

  describe("odds sources", () => {
    it("creates, reads and updates an odds source", async () => {
      const created = await db.oddsSource.create({
        data: {
          key: `src-${suffix}`,
          displayName: "Test Source",
          status: "UNKNOWN",
        },
      });
      ids.oddsSourceId = created.id;
      expect(created.status).toBe("UNKNOWN");

      const updated = await db.oddsSource.update({
        where: { id: created.id },
        data: { status: "HEALTHY" },
      });
      expect(updated.status).toBe("HEALTHY");

      const byKey = await db.oddsSource.findUnique({
        where: { key: `src-${suffix}` },
      });
      expect(byKey?.displayName).toBe("Test Source");
    });
  });

  describe("teams and aliases", () => {
    it("creates and reads a team with aliases", async () => {
      const team = await db.team.create({
        data: {
          name: `Team Alpha ${suffix}`,
          country: "ENG",
          aliases: {
            create: [
              { alias: `alpha-${suffix}` },
              { alias: `alpha-source-${suffix}`, oddsSourceId: ids.oddsSourceId },
            ],
          },
        },
        include: { aliases: true },
      });
      expect(team.aliases).toHaveLength(2);

      const found = await db.team.findUnique({
        where: { name: `Team Alpha ${suffix}` },
        include: { aliases: true },
      });
      expect(found?.aliases.map((a) => a.alias)).toContain(`alpha-${suffix}`);
    });

    it("rejects duplicate team names", async () => {
      const name = `Team Alpha ${suffix}`;
      await expect(db.team.create({ data: { name } })).rejects.toMatchObject({ code: "P2002" });
    });
  });

  describe("bookmakers", () => {
    it("creates, reads and updates a bookmaker", async () => {
      const created = await db.bookmaker.create({
        data: { name: `Betbook ${suffix}`, country: "KEN" },
      });
      expect(created.isActive).toBe(true);

      await db.bookmaker.update({
        where: { id: created.id },
        data: { isActive: false },
      });
      const read = await db.bookmaker.findFirst({
        where: { name: `Betbook ${suffix}` },
      });
      expect(read?.isActive).toBe(false);
    });
  });

  describe("settlement rules", () => {
    it("creates a versioned settlement rule", async () => {
      const rule = await db.settlementRule.create({
        data: {
          oddsSourceId: ids.oddsSourceId,
          family: "MATCH_TOTAL",
          marketType: "STANDARD",
          version: 1,
          description: "Standard over/under",
          ruleJson: { type: "line", unit: "goals" },
        },
      });
      expect(rule.version).toBe(1);

      const found = await db.settlementRule.findFirst({
        where: {
          oddsSourceId: ids.oddsSourceId,
          family: "MATCH_TOTAL",
          version: 1,
        },
      });
      expect(found?.marketType).toBe("STANDARD");
    });

    it("rejects duplicate rule versions for the same family/type", async () => {
      await expect(
        db.settlementRule.create({
          data: {
            oddsSourceId: ids.oddsSourceId,
            family: "MATCH_TOTAL",
            marketType: "STANDARD",
            version: 1,
          },
        })
      ).rejects.toMatchObject({ code: "P2002" });
    });
  });

  describe("events", () => {
    it("creates an event plus source event ids and reads back", async () => {
      const event = await db.event.create({
        data: {
          canonicalEventId: `evt-${suffix}`,
          competition: "Friendly",
          homeTeam: `Team Alpha ${suffix}`,
          awayTeam: `Team Beta ${suffix}`,
          startTime: new Date("2026-10-01T19:00:00Z"),
          sourceEventIds: {
            create: [
              {
                oddsSourceId: ids.oddsSourceId,
                sourceEventId: `src-evt-${suffix}`,
                startTime: new Date("2026-10-01T19:00:00Z"),
              },
            ],
          },
        },
        include: { sourceEventIds: true },
      });
      ids.eventId = event.id;
      expect(event.status).toBe("SCHEDULED");
      expect(event.sourceEventIds).toHaveLength(1);

      const found = await db.event.findUnique({
        where: { canonicalEventId: `evt-${suffix}` },
      });
      expect(found?.homeTeam).toBe(`Team Alpha ${suffix}`);

      const now = await db.event.update({
        where: { id: event.id },
        data: { status: "LIVE" },
      });
      expect(now.status).toBe("LIVE");
    });

    it("rejects duplicate canonical event ids", async () => {
      await expect(
        db.event.create({
          data: {
            canonicalEventId: `evt-${suffix}`,
            competition: "Friendly",
            homeTeam: "Home",
            awayTeam: "Away",
            startTime: new Date(),
          },
        })
      ).rejects.toMatchObject({ code: "P2002" });
    });
  });

  describe("markets", () => {
    it("creates, reads and updates a market bound to a settlement rule", async () => {
      const rule = await db.settlementRule.findFirstOrThrow({
        where: { oddsSourceId: ids.oddsSourceId, version: 1 },
      });

      const market = await db.market.create({
        data: {
          eventId: ids.eventId,
          oddsSourceId: ids.oddsSourceId,
          sourceMarketId: `mkt-${suffix}`,
          settlementRuleId: rule.id,
          period: "FULL_MATCH",
          family: "MATCH_TOTAL",
          marketType: "STANDARD",
          line: "2.5",
        },
      });
      ids.marketId = market.id;
      expect(market.status).toBe("OPEN");

      const grouped = await db.market.findMany({
        where: {
          eventId: ids.eventId,
          family: "MATCH_TOTAL",
          period: "FULL_MATCH",
          line: "2.5",
        },
      });
      expect(grouped).toHaveLength(1);

      const updated = await db.market.update({
        where: { id: market.id },
        data: { status: "SUSPENDED" },
      });
      expect(updated.status).toBe("SUSPENDED");
    });

    it("rejects duplicate source market ids within a source", async () => {
      const rule = await db.settlementRule.findFirstOrThrow({
        where: { oddsSourceId: ids.oddsSourceId, version: 1 },
      });
      await expect(
        db.market.create({
          data: {
            eventId: ids.eventId,
            oddsSourceId: ids.oddsSourceId,
            sourceMarketId: `mkt-${suffix}`,
            settlementRuleId: rule.id,
            period: "FULL_MATCH",
            family: "MATCH_RESULT",
            marketType: "1X2",
          },
        })
      ).rejects.toMatchObject({ code: "P2002" });
    });
  });

  describe("selections and odds observations", () => {
    it("creates a selection and its price history", async () => {
      const bookmaker = await db.bookmaker.findFirstOrThrow({
        where: { name: `Betbook ${suffix}` },
      });

      const selection = await db.selection.create({
        data: {
          marketId: ids.marketId,
          bookmakerId: bookmaker.id,
          outcome: "OVER",
          odds: new Prisma.Decimal("2.10"),
          observations: {
            create: [{ odds: new Prisma.Decimal("2.05") }, { odds: new Prisma.Decimal("2.10") }],
          },
        },
        include: { observations: true },
      });
      ids.selectionId = selection.id;
      expect(selection.observations).toHaveLength(2);
      expect(selection.odds.toNumber()).toBe(2.1);

      const bumped = await db.selection.update({
        where: { id: selection.id },
        data: { odds: new Prisma.Decimal("2.20") },
      });
      expect(bumped.odds.toNumber()).toBe(2.2);

      const history = await db.oddsObservation.findMany({
        where: { selectionId: selection.id },
        orderBy: { observedAt: "asc" },
      });
      expect(history.map((h) => h.odds.toNumber())).toEqual([2.05, 2.1]);
    });

    it("rejects duplicate outcome rows for the same market and bookmaker", async () => {
      const bookmaker = await db.bookmaker.findFirstOrThrow({
        where: { name: `Betbook ${suffix}` },
      });
      await expect(
        db.selection.create({
          data: {
            marketId: ids.marketId,
            bookmakerId: bookmaker.id,
            outcome: "OVER",
            odds: new Prisma.Decimal("2.30"),
          },
        })
      ).rejects.toMatchObject({ code: "P2002" });
    });
  });

  describe("raw payload retention", () => {
    it("stores a provider payload", async () => {
      const payload = await db.rawPayload.create({
        data: {
          oddsSourceId: ids.oddsSourceId,
          requestId: `req-${suffix}`,
          endpoint: "/sports/odds",
          payload: { sport: "soccer", markets: ["h2h"] },
        },
      });
      const read = await db.rawPayload.findFirst({
        where: { oddsSourceId: ids.oddsSourceId },
        orderBy: { receivedAt: "asc" },
      });
      expect(read?.requestId).toBe(`req-${suffix}`);
      expect(payload.payload).toMatchObject({ sport: "soccer" });
    });
  });

  describe("opportunities and legs", () => {
    it("creates an opportunity with legs and an audit trail", async () => {
      const opportunity = await db.opportunity.create({
        data: {
          id: `opp-${suffix}`,
          eventId: ids.eventId,
          status: "THEORETICAL_ARB",
          totalStake: new Prisma.Decimal("100.00"),
          minReturn: new Prisma.Decimal("100.75"),
          guaranteedProfit: new Prisma.Decimal("0.75"),
          roi: new Prisma.Decimal("0.0075"),
          engineVersion: "1.0.0-test",
          auditLogs: {
            create: [
              {
                action: `OPPORTUNITY_CREATED op-${suffix}`,
                detail: { engine: "1.0.0-test" },
              },
            ],
          },
        },
        include: { auditLogs: true },
      });
      expect(opportunity.auditLogs).toHaveLength(1);
      expect(opportunity.minReturn?.toNumber()).toBe(100.75);

      const leg = await db.opportunityLeg.create({
        data: {
          opportunityId: opportunity.id,
          selectionId: ids.selectionId,
          oddsSnapshot: new Prisma.Decimal("2.10"),
          stake: new Prisma.Decimal("50.00"),
          guaranteedReturn: new Prisma.Decimal("105.00"),
          settlementResult: "FULL_WIN",
        },
      });
      expect(leg.oddsSnapshot.toNumber()).toBe(2.1);

      const found = await db.opportunity.findUnique({
        where: { id: `opp-${suffix}` },
        include: { legs: true, auditLogs: true, event: true },
      });
      expect(found?.legs).toHaveLength(1);
      expect(found?.event.competition).toBe("Friendly");

      const byStatus = await db.opportunity.findMany({
        where: { status: "THEORETICAL_ARB" },
        orderBy: { detectedAt: "desc" },
      });
      expect(byStatus.some((o) => o.id === `opp-${suffix}`)).toBe(true);
    });
  });

  describe("scanner health", () => {
    it("creates and reads heartbeat rows and enforces unique run ids", async () => {
      const run = await db.scannerHealth.create({
        data: {
          runId: `run-${suffix}`,
          oddsSourceId: ids.oddsSourceId,
          status: "HEALTHY",
          message: "ok",
        },
      });
      expect(run.status).toBe("HEALTHY");

      await expect(
        db.scannerHealth.create({
          data: { runId: `run-${suffix}` },
        })
      ).rejects.toMatchObject({ code: "P2002" });

      const finished = await db.scannerHealth.update({
        where: { runId: `run-${suffix}` },
        data: { status: "DEGRADED", message: "slow poll" },
      });
      expect(finished.message).toBe("slow poll");
    });
  });
});
