/**
 * Phase 18: the Postgres-backed audit port.
 *
 * The guard fires these with `void`, so this port is the last line of defence
 * between a flood of rejected requests and the database. Two properties matter
 * here: writes are queued rather than awaited inline, and constructing the port
 * can never throw — `lib/api/runtime.ts` calls `dbAudit()` at module scope, so a
 * throw during import would take down every API route.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as AuditPort from "./audit";
import type { SecurityAuditEntry } from "./audit";

const enqueueAuditLog = vi.fn(() => ({
  enqueue: vi.fn(),
  stats: () => ({
    queueDepth: 0,
    droppedQueueFull: 0,
    droppedTooOld: 0,
    writeFailures: 0,
    drained: 0,
    inFlight: false,
  }),
}));
const getPrismaClient = vi.fn(() => ({}) as never);

vi.mock("@22void/db", () => ({
  enqueueAuditLog: (...args: unknown[]) => enqueueAuditLog(...(args as [])),
  getPrismaClient: (...args: unknown[]) => getPrismaClient(...(args as [])),
}));

type AuditModule = typeof AuditPort;

let mod: AuditModule;

beforeEach(async () => {
  vi.resetModules();
  enqueueAuditLog.mockClear();
  getPrismaClient.mockClear();
  getPrismaClient.mockImplementation(() => ({}) as never);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mod = await import("./audit");
});

describe("dbAudit", () => {
  it("does not build the Prisma client until something is actually recorded", async () => {
    // Constructing the port must stay side-effect free: it runs at module scope.
    mod.dbAudit();
    expect(getPrismaClient).not.toHaveBeenCalled();
  });

  it("queues writes with the conventional entity type applied", async () => {
    await mod.dbAudit().record({ action: "AUTH_FAILED", actor: "1.1.1.1" });
    expect(getPrismaClient).toHaveBeenCalledTimes(1);
    const enqueue = enqueueAuditLog.mock.results[0]!.value.enqueue as ReturnType<typeof vi.fn>;
    expect(enqueue).toHaveBeenCalledWith({
      action: "AUTH_FAILED",
      actor: "1.1.1.1",
      entityType: "security",
    });
  });

  it("swallows a client construction failure instead of throwing", async () => {
    // A missing or invalid DATABASE_URL must not reject the audit call, and must
    // not propagate out of the module-scope dbAudit() in runtime.ts.
    getPrismaClient.mockImplementation(() => {
      throw new Error("DATABASE_URL is not set");
    });
    await expect(mod.dbAudit().record({ action: "AUTH_FAILED" })).resolves.toBeUndefined();
  });

  it("shares one queue across every port instance", async () => {
    await mod.dbAudit().record({ action: "AUTH_FAILED" });
    await mod.dbAudit().record({ action: "RATE_LIMITED" });
    await mod.dbAudit().record({ action: "ADMIN_ACCESS" });
    // One queue for the process, not one per dbAudit() call: per-call queues
    // would each hold their own backlog and bound nothing in aggregate.
    expect(enqueueAuditLog).toHaveBeenCalledTimes(1);
  });

  it("stops retrying client construction after a failure", async () => {
    getPrismaClient.mockImplementation(() => {
      throw new Error("DATABASE_URL is not set");
    });
    await mod.dbAudit().record({ action: "AUTH_FAILED" });
    await mod.dbAudit().record({ action: "AUTH_FAILED" });
    await mod.dbAudit().record({ action: "AUTH_FAILED" });
    // Latched after the first failure so a misconfigured deploy does not warn on
    // every rejected request.
    expect(getPrismaClient).toHaveBeenCalledTimes(1);
  });
});

describe("nullAudit", () => {
  it("resolves without touching the database", async () => {
    await expect(mod.nullAudit.record({ action: "AUTH_FAILED" })).resolves.toBeUndefined();
  });
});

describe("memoryAudit", () => {
  it("captures entries in order", async () => {
    const log: SecurityAuditEntry[] = [];
    const audit = mod.memoryAudit(log);
    await audit.record({ action: "FIRST" });
    await audit.record({ action: "SECOND" });
    expect(log.map((e) => e.action)).toEqual(["FIRST", "SECOND"]);
  });
});
