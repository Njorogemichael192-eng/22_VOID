import { describe, expect, it } from "vitest";
import type { PrismaClient } from "./generated/client/client.js";
import {
  applyRetention,
  DEFAULT_RETENTION_BATCH_SIZE,
  DEFAULT_RETENTION_MAX_BATCHES,
  DEFAULT_RETENTION_POLICY,
  resolveRetentionPolicy,
  retentionColumn,
  retentionCutoff,
  RETENTION_TABLES,
} from "./retention.js";

const NOW = new Date("2026-10-04T12:00:00.000Z");

/**
 * `applyRetention` only ever calls `$executeRaw` / `$queryRaw`, so a structural
 * fake is enough — no need to stand up Postgres or mock the generated client.
 * The fake recovers the table name from the literal SQL, which doubles as an
 * assertion that each pruner targets the table and column it claims to.
 */
interface ExecutedDelete {
  table: string;
  sql: string;
  cutoff: unknown;
  batchSize: unknown;
}

function createFakeDb(
  deleteQueues: Record<string, number[]>,
  eligible: Record<string, number> = {}
) {
  const deletes: ExecutedDelete[] = [];
  const counts: { table: string; cutoff: unknown }[] = [];

  const db = {
    $executeRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const sql = strings.join("?");
      const table = /DELETE FROM "(\w+)"/.exec(sql)?.[1] ?? "?";
      const queue = deleteQueues[table] ?? [];
      const next = queue.length > 0 ? (queue.shift() as number) : 0;
      // batchSize is interpolated last; cutoff is the only other parameter.
      deletes.push({ table, sql, cutoff: values[0], batchSize: values[values.length - 1] });
      return Promise.resolve(next);
    },
    $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const sql = strings.join("?");
      const table = /FROM "(\w+)"/.exec(sql)?.[1] ?? "?";
      counts.push({ table, cutoff: values[0] });
      return Promise.resolve([{ count: eligible[table] ?? 0 }]);
    },
  } as unknown as PrismaClient;

  return { db, deletes, counts };
}

describe("retentionCutoff", () => {
  it("subtracts whole days from the reference instant", () => {
    expect(retentionCutoff(NOW, 7).toISOString()).toBe("2026-09-27T12:00:00.000Z");
  });

  it("is exact for a fractional window", () => {
    expect(retentionCutoff(NOW, 0.5).toISOString()).toBe("2026-10-04T00:00:00.000Z");
  });

  it("moves forward for a negative window rather than erroring", () => {
    // Negativity is rejected upstream in resolveRetentionPolicy/applyRetention;
    // this pins the arithmetic so a caller cannot smuggle a future cutoff past
    // the validator.
    expect(retentionCutoff(NOW, -1).toISOString()).toBe("2026-10-05T12:00:00.000Z");
  });
});

describe("resolveRetentionPolicy", () => {
  it("keeps audit logs indefinitely by default", () => {
    expect(DEFAULT_RETENTION_POLICY.auditLogDays).toBeNull();
    expect(resolveRetentionPolicy().auditLogDays).toBeNull();
  });

  it("merges overrides over defaults without mutating the defaults", () => {
    const policy = resolveRetentionPolicy({ rawPayloadDays: 14 });
    expect(policy.rawPayloadDays).toBe(14);
    expect(policy.scannerHealthDays).toBe(DEFAULT_RETENTION_POLICY.scannerHealthDays);
    expect(DEFAULT_RETENTION_POLICY.rawPayloadDays).toBe(7);
  });

  it("accepts an explicit null to disable a default-enabled table", () => {
    expect(resolveRetentionPolicy({ oddsObservationDays: null }).oddsObservationDays).toBeNull();
  });

  it("rejects zero and negative windows", () => {
    expect(() => resolveRetentionPolicy({ rawPayloadDays: 0 })).toThrow(/positive number of days/);
    expect(() => resolveRetentionPolicy({ scannerHealthDays: -1 })).toThrow(/positive number/);
  });

  it("rejects non-finite windows", () => {
    expect(() => resolveRetentionPolicy({ auditLogDays: Number.NaN })).toThrow(/positive number/);
  });
});

describe("retentionColumn", () => {
  it("maps every table to its own timestamp column", () => {
    expect(retentionColumn("raw_payloads")).toBe("receivedAt");
    expect(retentionColumn("scanner_health")).toBe("startedAt");
    expect(retentionColumn("odds_observations")).toBe("observedAt");
    expect(retentionColumn("audit_logs")).toBe("createdAt");
  });
});

describe("applyRetention dry run", () => {
  it("issues no DELETE and reports eligible rows per table", async () => {
    const { db, deletes, counts } = createFakeDb({}, { raw_payloads: 42 });
    const report = await applyRetention(db, {
      now: NOW,
      dryRun: true,
      tables: ["raw_payloads"],
    });

    expect(deletes).toHaveLength(0);
    expect(report.dryRun).toBe(true);
    expect(report.totalDeleted).toBe(0);
    expect(counts[0]?.cutoff).toEqual(retentionCutoff(NOW, 7));
    const row = report.tables[0];
    expect(row?.eligible).toBe(42);
    expect(row?.exhausted).toBe(true);
  });

  it("does not mark a table pending when nothing is eligible", async () => {
    const { db } = createFakeDb({}, { raw_payloads: 0 });
    const report = await applyRetention(db, { now: NOW, dryRun: true, tables: ["raw_payloads"] });
    expect(report.tables[0]?.exhausted).toBe(false);
    expect(report.stillPending).toBe(false);
  });

  it("skips audit_logs entirely under the default policy", async () => {
    const { db, deletes, counts } = createFakeDb({}, { audit_logs: 999 });
    const report = await applyRetention(db, { now: NOW, dryRun: true });

    expect(deletes).toHaveLength(0);
    expect(counts.map((entry) => entry.table)).not.toContain("audit_logs");
    const audit = report.tables.find((row) => row.table === "audit_logs");
    expect(audit?.windowDays).toBeNull();
    expect(audit?.cutoff).toBeNull();
    expect(audit?.eligible).toBeNull();
    expect(audit?.batches).toBe(0);
  });

  it("prunes audit_logs once an operator opts in", async () => {
    const { db, counts } = createFakeDb({}, { audit_logs: 5 });
    const report = await applyRetention(db, {
      now: NOW,
      dryRun: true,
      policy: { auditLogDays: 365 },
      tables: ["audit_logs"],
    });
    expect(counts.map((entry) => entry.table)).toContain("audit_logs");
    expect(report.tables[0]?.eligible).toBe(5);
  });
});

describe("applyRetention batching", () => {
  it("stops after a short batch instead of issuing an extra DELETE", async () => {
    const { db, deletes } = createFakeDb({ raw_payloads: [2, 1] });
    const report = await applyRetention(db, {
      now: NOW,
      batchSize: 2,
      tables: ["raw_payloads"],
    });

    expect(deletes).toHaveLength(2);
    expect(report.totalDeleted).toBe(3);
    expect(report.tables[0]?.exhausted).toBe(false);
    expect(report.stillPending).toBe(false);
  });

  it("stops immediately when the first batch is empty", async () => {
    const { db, deletes } = createFakeDb({ raw_payloads: [] });
    const report = await applyRetention(db, {
      now: NOW,
      batchSize: 2,
      tables: ["raw_payloads"],
    });
    expect(deletes).toHaveLength(1);
    expect(report.totalDeleted).toBe(0);
    expect(report.tables[0]?.exhausted).toBe(false);
  });

  it("caps work at maxBatches and reports the remaining backlog", async () => {
    const { db, deletes, counts } = createFakeDb(
      { raw_payloads: [2, 2, 2] },
      { raw_payloads: 500 }
    );
    const report = await applyRetention(db, {
      now: NOW,
      batchSize: 2,
      maxBatches: 3,
      tables: ["raw_payloads"],
    });

    expect(deletes).toHaveLength(3);
    expect(report.totalDeleted).toBe(6);
    const row = report.tables[0];
    expect(row?.exhausted).toBe(true);
    expect(row?.eligible).toBe(500);
    expect(report.stillPending).toBe(true);
    // The recount is what distinguishes "all done" from "ceiling reached".
    expect(counts).toHaveLength(1);
  });

  it("passes the cutoff and batch size as query parameters", async () => {
    const { db, deletes } = createFakeDb({ raw_payloads: [1] });
    await applyRetention(db, {
      now: NOW,
      batchSize: 25,
      tables: ["raw_payloads"],
    });
    expect(deletes[0]?.cutoff).toEqual(retentionCutoff(NOW, 7));
    expect(deletes[0]?.batchSize).toBe(25);
  });

  it("targets the documented timestamp column for every table", async () => {
    for (const table of RETENTION_TABLES) {
      const { db, deletes } = createFakeDb({ [table]: [1] });
      await applyRetention(db, {
        now: NOW,
        batchSize: 1,
        policy: { auditLogDays: 1 },
        tables: [table],
      });
      expect(deletes[0]?.table).toBe(table);
      expect(deletes[0]?.sql).toContain(`"${retentionColumn(table)}" < ?`);
      expect(deletes[0]?.sql).toContain("ORDER BY");
      expect(deletes[0]?.sql).toContain("LIMIT ?");
    }
  });

  it("defaults the batch ceiling to a bounded value", () => {
    expect(DEFAULT_RETENTION_BATCH_SIZE).toBe(1_000);
    expect(DEFAULT_RETENTION_MAX_BATCHES).toBeGreaterThan(0);
    expect(DEFAULT_RETENTION_BATCH_SIZE * DEFAULT_RETENTION_MAX_BATCHES).toBe(20_000);
  });

  it("rejects a non-positive batch size or ceiling", async () => {
    const { db } = createFakeDb({});
    await expect(applyRetention(db, { batchSize: 0 })).rejects.toThrow(/positive integer/);
    await expect(applyRetention(db, { maxBatches: -1 })).rejects.toThrow(/positive integer/);
  });

  it("rejects a zero window at apply time even if it bypassed the policy merge", async () => {
    const { db } = createFakeDb({});
    await expect(
      applyRetention(db, { policy: { rawPayloadDays: 0 }, tables: ["raw_payloads"] })
    ).rejects.toThrow(/positive number of days/);
  });
});

describe("applyRetention reporting", () => {
  it("returns one report row per selected table in order", async () => {
    const { db } = createFakeDb({});
    const report = await applyRetention(db, {
      now: NOW,
      dryRun: true,
      tables: ["audit_logs", "raw_payloads"],
    });
    expect(report.tables.map((row) => row.table)).toEqual(["audit_logs", "raw_payloads"]);
  });

  it("always includes every table when none are selected", async () => {
    const { db } = createFakeDb({}, {});
    const report = await applyRetention(db, { now: NOW, dryRun: true });
    expect(report.tables.map((row) => row.table)).toEqual([...RETENTION_TABLES]);
  });

  it("sums deletions across tables", async () => {
    const { db } = createFakeDb({ raw_payloads: [2], scanner_health: [3] });
    const report = await applyRetention(db, {
      now: NOW,
      batchSize: 5,
      tables: ["raw_payloads", "scanner_health"],
    });
    expect(report.totalDeleted).toBe(5);
  });

  it("reports a non-negative duration", async () => {
    const { db } = createFakeDb({}, {});
    const report = await applyRetention(db, { now: NOW, dryRun: true });
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });
});
