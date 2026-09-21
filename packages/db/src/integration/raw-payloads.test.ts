import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPrismaClient,
  ensureOddsSource,
  storeRawPayload,
  type PrismaClient,
} from "../index.js";

/**
 * Phase 3 — raw payload retention integration test.
 *
 * Same DATABASE_URL skip-if-unreachable convention as crud.test.ts, so plain
 * `npm test` stays green without a running PostgreSQL; the CI db-integration
 * job exercises it with a live database.
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

describe.skipIf(!dbAvailable)("Phase 3 — raw payload retention", () => {
  let db: PrismaClient;
  const suffix = `${Date.now()}`;
  let oddsSourceId = "";
  let payloadId = "";

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    db = createPrismaClient(process.env.DATABASE_URL);
    const source = await ensureOddsSource(db, `provider-${suffix}`, "Odds-API.io (test)");
    oddsSourceId = source.id;
  });

  afterAll(async () => {
    await db.rawPayload.deleteMany({ where: { oddsSourceId } });
    await db.oddsSource.delete({ where: { id: oddsSourceId } });
    await db.$disconnect();
  });

  it("stores and reads back a verbatim provider payload with timestamps", async () => {
    const verbatim = {
      id: "oddsepl001",
      sport_key: "soccer_epl",
      home_team: "Manchester City",
      away_team: "Arsenal",
      commence_time: "2026-11-21T19:00:00.000Z",
      bookmakers: [],
    };

    const receivedAt = new Date("2026-11-21T08:00:00.000Z");
    const stored = await storeRawPayload({
      db,
      oddsSourceId,
      requestId: `req-${suffix}`,
      endpoint: "/v4/sports/soccer_epl/odds",
      payload: verbatim,
      receivedAt,
    });
    payloadId = stored.id;
    expect(stored.requestId).toBe(`req-${suffix}`);
    expect(stored.receivedAt.toISOString()).toBe(receivedAt.toISOString());

    const read = await db.rawPayload.findFirst({
      where: { oddsSourceId, requestId: `req-${suffix}` },
    });
    expect(read?.endpoint).toBe("/v4/sports/soccer_epl/odds");
    expect(read?.payload).toMatchObject({ id: "oddsepl001" });
    expect(read?.receivedAt.toISOString()).toBe(receivedAt.toISOString());
  });

  it("is idempotent in registering the odds source key", async () => {
    const again = await ensureOddsSource(db, `provider-${suffix}`, "renamed");
    expect(again.id).toBe(oddsSourceId);
  });

  it("returns a stable row id for replayed payloads", async () => {
    await storeRawPayload({
      db,
      oddsSourceId,
      requestId: `req-${suffix}-replay`,
      payload: { replay: true },
    });
    const replay = await db.rawPayload.findFirst({
      where: { requestId: `req-${suffix}-replay` },
    });
    expect(replay).not.toBeNull();
    expect(replay?.id).not.toBe(payloadId);
  });
});
