import type { PrismaClient } from "./generated/client/client";

/**
 * Retention enforcement (Phase 19 Step 1, spec §65).
 *
 * Spec §65 requires storing the verbatim provider wire payload "long enough to
 * debug" while also applying retention "so storage doesn't grow without
 * control". Only the first half shipped: `storeRawPayload` appends on every
 * poll and nothing ever removes a row, so `raw_payloads` grows without bound
 * (~3 kB per mock payload, ~530 MB/month at a 4/min poll rate, more with real
 * provider responses).
 *
 * Design constraints:
 *
 * - Bounded work per invocation. Each table is drained in `batchSize` chunks
 *   for at most `maxBatches` rounds. A large backlog is therefore reported as
 *   "still pending" rather than deleted inside one unbounded statement, and a
 *   rerun continues where the previous one stopped. This mirrors the Phase 18
 *   scheduler lesson: a maintenance path that cannot run long enough to wedge
 *   the scan loop should not exist in the first place.
 * - One autocommit statement per batch. Deliberately *not* wrapped in a single
 *   transaction: a partial prune is safe and resumable, whereas one long
 *   transaction would hold locks and inflate the WAL for the whole run.
 * - No unbounded identifier interpolation. Each table has its own literal
 *   statement below, so there is no dynamic SQL surface to get wrong.
 */

export type RetentionTable = "raw_payloads" | "scanner_health" | "odds_observations" | "audit_logs";

/** Per-table retention window in days; `null` means "keep indefinitely". */
export interface RetentionPolicy {
  rawPayloadDays: number | null;
  scannerHealthDays: number | null;
  oddsObservationDays: number | null;
  auditLogDays: number | null;
}

/**
 * Defaults chosen against measured production growth rather than guesses.
 *
 * `auditLogDays` is `null` by design. `audit_logs` is the system's audit trail
 * (spec §66); pruning it to save space is a compliance decision that belongs to
 * an operator, not to a default. Every other table is operational telemetry
 * whose retention only costs debug capability.
 */
export const DEFAULT_RETENTION_POLICY: Readonly<RetentionPolicy> = Object.freeze({
  rawPayloadDays: 7,
  scannerHealthDays: 30,
  oddsObservationDays: 90,
  auditLogDays: null,
});

/** Rows removed per statement. Keeps any single DELETE short and lock-light. */
export const DEFAULT_RETENTION_BATCH_SIZE = 1_000;

/** Statements per table per invocation; caps the latency a prune can add. */
export const DEFAULT_RETENTION_MAX_BATCHES = 20;

/** The timestamp column each table is pruned on. Documented for operator review. */
const RETENTION_COLUMN: Readonly<Record<RetentionTable, string>> = Object.freeze({
  raw_payloads: "receivedAt",
  scanner_health: "startedAt",
  odds_observations: "observedAt",
  audit_logs: "createdAt",
});

interface TablePruner {
  deleteBatch(db: PrismaClient, cutoff: Date, batchSize: number): Promise<number>;
  countEligible(db: PrismaClient, cutoff: Date): Promise<number>;
}

async function countRows(rows: unknown): Promise<number> {
  const value = (rows as { count?: bigint | number }[])[0]?.count ?? 0;
  return typeof value === "bigint" ? Number(value) : value;
}

/**
 * One pruner per table. Each body is a literal statement so the table and
 * column names are fixed at compile time rather than assembled at runtime.
 */
const RETENTION_PRUNER: Readonly<Record<RetentionTable, TablePruner>> = Object.freeze({
  raw_payloads: {
    async deleteBatch(db, cutoff, batchSize) {
      return db.$executeRaw`
        DELETE FROM "raw_payloads"
        WHERE "id" IN (
          SELECT "id" FROM "raw_payloads"
          WHERE "receivedAt" < ${cutoff}
          ORDER BY "receivedAt"
          LIMIT ${batchSize}
        )`;
    },
    async countEligible(db, cutoff) {
      return countRows(
        await db.$queryRaw`SELECT count(*) AS "count" FROM "raw_payloads" WHERE "receivedAt" < ${cutoff}`
      );
    },
  },
  scanner_health: {
    async deleteBatch(db, cutoff, batchSize) {
      return db.$executeRaw`
        DELETE FROM "scanner_health"
        WHERE "id" IN (
          SELECT "id" FROM "scanner_health"
          WHERE "startedAt" < ${cutoff}
          ORDER BY "startedAt"
          LIMIT ${batchSize}
        )`;
    },
    async countEligible(db, cutoff) {
      return countRows(
        await db.$queryRaw`SELECT count(*) AS "count" FROM "scanner_health" WHERE "startedAt" < ${cutoff}`
      );
    },
  },
  odds_observations: {
    async deleteBatch(db, cutoff, batchSize) {
      return db.$executeRaw`
        DELETE FROM "odds_observations"
        WHERE "id" IN (
          SELECT "id" FROM "odds_observations"
          WHERE "observedAt" < ${cutoff}
          ORDER BY "observedAt"
          LIMIT ${batchSize}
        )`;
    },
    async countEligible(db, cutoff) {
      return countRows(
        await db.$queryRaw`SELECT count(*) AS "count" FROM "odds_observations" WHERE "observedAt" < ${cutoff}`
      );
    },
  },
  audit_logs: {
    async deleteBatch(db, cutoff, batchSize) {
      return db.$executeRaw`
        DELETE FROM "audit_logs"
        WHERE "id" IN (
          SELECT "id" FROM "audit_logs"
          WHERE "createdAt" < ${cutoff}
          ORDER BY "createdAt"
          LIMIT ${batchSize}
        )`;
    },
    async countEligible(db, cutoff) {
      return countRows(
        await db.$queryRaw`SELECT count(*) AS "count" FROM "audit_logs" WHERE "createdAt" < ${cutoff}`
      );
    },
  },
});

/** All prunable tables, in the order a run touches them. */
export const RETENTION_TABLES: readonly RetentionTable[] = Object.freeze([
  "raw_payloads",
  "scanner_health",
  "odds_observations",
  "audit_logs",
] as const);

/** The timestamp column a given table is pruned on. */
export function retentionColumn(table: RetentionTable): string {
  return RETENTION_COLUMN[table];
}

function assertWindow(table: RetentionTable, windowDays: number | null): number | null {
  if (windowDays === null) return null;
  if (!Number.isFinite(windowDays) || windowDays <= 0) {
    throw new Error(`retention window for ${table} must be a positive number of days or null`);
  }
  return windowDays;
}

/** Merge caller overrides over the defaults, validating each window. */
export function resolveRetentionPolicy(overrides: Partial<RetentionPolicy> = {}): RetentionPolicy {
  const merged: RetentionPolicy = { ...DEFAULT_RETENTION_POLICY, ...overrides };
  for (const table of RETENTION_TABLES) {
    assertWindow(table, merged[tableToPolicyKey(table)]);
  }
  return merged;
}

function tableToPolicyKey(table: RetentionTable): keyof RetentionPolicy {
  switch (table) {
    case "raw_payloads":
      return "rawPayloadDays";
    case "scanner_health":
      return "scannerHealthDays";
    case "odds_observations":
      return "oddsObservationDays";
    case "audit_logs":
      return "auditLogDays";
  }
}

/** The cutoff instant for a window: `now` minus that many whole days. */
export function retentionCutoff(now: Date, windowDays: number): Date {
  return new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1_000);
}

export interface ApplyRetentionOptions {
  /** Per-table window overrides; omitted keys use {@link DEFAULT_RETENTION_POLICY}. */
  policy?: Partial<RetentionPolicy>;
  /** Reference instant for cutoff computation (default: current time). */
  now?: Date;
  /** Rows per DELETE statement (default 1000). */
  batchSize?: number;
  /** Max statements per table per call (default 20). */
  maxBatches?: number;
  /** Report what would be deleted without deleting anything. */
  dryRun?: boolean;
  /** Restrict the run to these tables (default: all of them). */
  tables?: readonly RetentionTable[];
}

export interface RetentionTableReport {
  table: RetentionTable;
  column: string;
  windowDays: number | null;
  cutoff: string | null;
  /** Rows eligible for deletion, or `null` when the table is skipped. */
  eligible: number | null;
  deleted: number;
  batches: number;
  /** True when the batch ceiling was hit and eligible rows remain. */
  exhausted: boolean;
}

export interface RetentionReport {
  dryRun: boolean;
  durationMs: number;
  tables: RetentionTableReport[];
  totalDeleted: number;
  /** True when at least one table still had eligible rows after the run. */
  stillPending: boolean;
}

/**
 * Prune every enabled table up to its window, in bounded batches.
 *
 * Never throws for an individual table's absence — a missing optional table is
 * reported as skipped rather than aborting the whole run, so a partially
 * migrated database can still be maintained.
 */
export async function applyRetention(
  db: PrismaClient,
  options: ApplyRetentionOptions = {}
): Promise<RetentionReport> {
  const startedAt = Date.now();
  const policy = resolveRetentionPolicy(options.policy ?? {});
  const batchSize = options.batchSize ?? DEFAULT_RETENTION_BATCH_SIZE;
  const maxBatches = options.maxBatches ?? DEFAULT_RETENTION_MAX_BATCHES;
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? false;
  const selected = options.tables ?? RETENTION_TABLES;

  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error(`retention batchSize must be a positive integer, got ${batchSize}`);
  }
  if (!Number.isInteger(maxBatches) || maxBatches <= 0) {
    throw new Error(`retention maxBatches must be a positive integer, got ${maxBatches}`);
  }

  const reports: RetentionTableReport[] = [];

  for (const table of selected) {
    const pruner = RETENTION_PRUNER[table];
    const windowDays = assertWindow(table, policy[tableToPolicyKey(table)]);

    if (windowDays === null) {
      reports.push({
        table,
        column: retentionColumn(table),
        windowDays: null,
        cutoff: null,
        eligible: null,
        deleted: 0,
        batches: 0,
        exhausted: false,
      });
      continue;
    }

    const cutoff = retentionCutoff(now, windowDays);

    if (dryRun) {
      const eligible = await pruner.countEligible(db, cutoff);
      reports.push({
        table,
        column: retentionColumn(table),
        windowDays,
        cutoff: cutoff.toISOString(),
        eligible,
        deleted: 0,
        batches: 0,
        exhausted: eligible > 0,
      });
      continue;
    }

    let deleted = 0;
    let batches = 0;
    let exhausted = false;

    while (batches < maxBatches) {
      const removed = await pruner.deleteBatch(db, cutoff, batchSize);
      batches += 1;
      if (removed === 0) break;
      deleted += removed;
      // A short batch means the backlog for this table is drained.
      if (removed < batchSize) break;
      if (batches === maxBatches) exhausted = true;
    }

    // Only pay for the count when the batch ceiling was hit, i.e. when we
    // actually need to tell the operator that work remains.
    const eligible = exhausted ? await pruner.countEligible(db, cutoff) : null;

    reports.push({
      table,
      column: retentionColumn(table),
      windowDays,
      cutoff: cutoff.toISOString(),
      eligible,
      deleted,
      batches,
      exhausted,
    });
  }

  const stillPending = reports.some((report) => report.exhausted);
  return {
    dryRun,
    durationMs: Date.now() - startedAt,
    tables: reports,
    totalDeleted: reports.reduce((sum, report) => sum + report.deleted, 0),
    stillPending,
  };
}
