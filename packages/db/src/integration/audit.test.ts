import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient, writeAuditLog } from "../index.js";

/**
 * Phase 16 security-audit write integration.
 *
 * Same skip-if-unreachable convention as store.test.ts / crud.test.ts: plain
 * `npm test` stays green without a database; the CI db-integration job
 * exercises it for real.
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

describe.skipIf(!dbAvailable)("Phase 16 - security audit write integration", () => {
  let db: PrismaClient;
  let entityId: string | undefined;

  const whereFor = (id: string | undefined) =>
    id === undefined
      ? { entityType: "security" }
      : { entityType: "security", entityId: id };

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    db = createPrismaClient(process.env.DATABASE_URL);
    const suffix = Date.now();
    entityId = `audit-${suffix}`;
    await db.auditLog.deleteMany({ where: whereFor(entityId) });
  });

  afterAll(async () => {
    if (entityId) await db.auditLog.deleteMany({ where: whereFor(entityId) });
    await db.$disconnect().catch(() => undefined);
  });

  it("persists a security audit event readable by the admin filter", async () => {
    await writeAuditLog(db, {
      action: "AUTH_FAILED",
      actor: "203.0.113.7",
      entityType: "security",
      entityId: entityId!,
      detail: { path: "/api/v1/events" },
    });

    const row = await db.auditLog.findFirst({
      where: whereFor(entityId),
      orderBy: { createdAt: "desc" },
    });
    expect(row).not.toBeNull();
    expect(row!.action).toBe("AUTH_FAILED");
    expect(row!.actor).toBe("203.0.113.7");
    expect(row!.detail).toMatchObject({ path: "/api/v1/events" });
  });
});