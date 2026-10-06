/**
 * 22_VOID retention enforcement (Phase 19 Step 1, spec §65).
 *
 * Deletes telemetry that has aged past its configured window. Defaults to a
 * dry run: pass --apply to actually delete. Dry run is the default because the
 * windows are the only thing standing between this command and irreversible
 * loss of history, and a mistyped window should cost nothing.
 *
 * Usage:
 *   DATABASE_URL=<postgres url> npm run db:retention                 # dry run
 *   DATABASE_URL=<postgres url> npm run db:retention -- --apply      # delete
 *   RETENTION_RAW_PAYLOAD_DAYS=14 npm run db:retention -- --apply
 *   npm run db:retention -- --apply --json --batch-size 500 --max-batches 5
 *
 * Windows are whole days; unset uses the package default. A table is only
 * pruned if its window is a positive number, so `0` is a configuration error
 * rather than a way to wipe a table.
 *
 * Bounds come from --batch-size / --max-batches, else RETENTION_BATCH_SIZE /
 * RETENTION_MAX_BATCHES, else the package default. An explicit flag wins over
 * ambient env, so a one-off run cannot be silently reshaped by whatever the
 * operator's shell happens to export.
 */

import {
  applyRetention,
  createPrismaClient,
  DEFAULT_RETENTION_BATCH_SIZE,
  DEFAULT_RETENTION_MAX_BATCHES,
  type RetentionPolicy,
  type RetentionReport,
} from "@22void/db";

const WINDOW_ENV: Record<keyof RetentionPolicy, string> = {
  rawPayloadDays: "RETENTION_RAW_PAYLOAD_DAYS",
  scannerHealthDays: "RETENTION_SCANNER_HEALTH_DAYS",
  oddsObservationDays: "RETENTION_OBSERVATIONS_DAYS",
  auditLogDays: "RETENTION_AUDIT_LOGS_DAYS",
};

function readWindow(key: keyof RetentionPolicy): number | null | undefined {
  const raw = process.env[WINDOW_ENV[key]];
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${WINDOW_ENV[key]} must be a number of days, got ${JSON.stringify(raw)}`);
  }
  // 0 and negatives are rejected by applyRetention; pass them through so the
  // error names the table rather than the env var.
  return value;
}

/**
 * Resolves one bounded-integer setting from, in order: an explicit CLI flag, the
 * environment, then the package default. The flag wins so that a single
 * deliberate invocation is not reshaped by an unrelated exported variable.
 *
 * The error names whichever source was actually bad, because "invalid value"
 * with no mention of the flag or the env var is what makes these miserable to
 * debug from a cron log.
 */
function readBoundedInt(
  args: readonly string[],
  flag: string,
  envVar: string,
  fallback: number
): number {
  const flagIndex = args.indexOf(flag);
  if (flagIndex >= 0) {
    const raw = args[flagIndex + 1];
    if (raw === undefined) {
      throw new Error(`${flag} requires a value, e.g. ${flag} 500`);
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${flag} must be a positive integer, got ${JSON.stringify(raw)}`);
    }
    return value;
  }
  const rawEnv = process.env[envVar];
  if (rawEnv === undefined || rawEnv.trim() === "") return fallback;
  const value = Number(rawEnv);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${envVar} must be a positive integer, got ${JSON.stringify(rawEnv)}`);
  }
  return value;
}

function printReport(report: RetentionReport): void {
  const verb = report.dryRun ? "would delete" : "deleted";
  console.log("");
  console.log(`  mode        ${report.dryRun ? "DRY RUN (no rows changed)" : "APPLY"}`);
  console.log(`  duration    ${report.durationMs}ms`);
  console.log("");
  console.log(
    `  ${"table".padEnd(20)}${"window".padEnd(9)}${"cutoff".padEnd(26)}${"eligible".padEnd(11)}${verb.padEnd(14)}batches`
  );
  for (const row of report.tables) {
    const window = row.windowDays === null ? "keep" : `${row.windowDays}d`;
    const cutoff = row.cutoff === null ? "-" : row.cutoff.slice(0, 19).replace("T", " ") + "Z";
    const eligible = row.eligible === null ? (row.exhausted ? "?" : "-") : String(row.eligible);
    console.log(
      `  ${row.table.padEnd(20)}${window.padEnd(9)}${cutoff.padEnd(26)}${eligible.padEnd(11)}${String(
        row.deleted
      ).padEnd(14)}${row.batches}`
    );
  }
  console.log("");
  console.log(`  total ${verb}: ${report.totalDeleted}`);
  if (report.stillPending) {
    console.log("");
    console.log("  NOTE: the per-run batch ceiling was reached, so some eligible rows remain.");
    console.log("        This run is resumable — run it again to continue draining.");
  }
}

async function main(): Promise<number> {
  const databaseUrl = (process.env.DATABASE_URL ?? "").trim();
  if (databaseUrl === "") {
    console.error("DATABASE_URL is required");
    return 1;
  }

  const args = process.argv.slice(2);
  const flags = new Set(args);
  const dryRun = !flags.has("--apply");
  const asJson = flags.has("--json");

  const policy: Partial<RetentionPolicy> = {};
  for (const key of Object.keys(WINDOW_ENV) as (keyof RetentionPolicy)[]) {
    const value = readWindow(key);
    if (value !== undefined) policy[key] = value;
  }

  const db = createPrismaClient(databaseUrl);
  try {
    const report = await applyRetention(db, {
      policy,
      dryRun,
      batchSize: readBoundedInt(
        args,
        "--batch-size",
        "RETENTION_BATCH_SIZE",
        DEFAULT_RETENTION_BATCH_SIZE
      ),
      maxBatches: readBoundedInt(
        args,
        "--max-batches",
        "RETENTION_MAX_BATCHES",
        DEFAULT_RETENTION_MAX_BATCHES
      ),
    });
    if (asJson) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      if (dryRun) {
        console.log("");
        console.log("  Dry run: nothing was deleted. Re-run with --apply to enforce.");
      }
      printReport(report);
    }
    return 0;
  } finally {
    await db.$disconnect();
  }
}

/**
 * Self-test for the argument/env resolution, run via `--self-test`.
 *
 * The precedence order (flag > env > default) is the part worth pinning: the
 * original version of this script documented `--batch-size` in its usage while
 * ignoring it, so a documented control that does nothing is worse than an
 * undocumented one. No database is touched here.
 */
function runSelfTest(): void {
  const envBackup = { ...process.env };
  try {
    const check = (label: string, actual: unknown, expected: unknown): void => {
      if (actual !== expected) {
        throw new Error(
          `[db-retention] SELF-TEST FAIL - ${label}: expected ${String(expected)}, got ${String(actual)}`
        );
      }
    };
    const rejects = (label: string, fn: () => unknown): void => {
      try {
        fn();
      } catch {
        return;
      }
      throw new Error(`[db-retention] SELF-TEST FAIL - ${label}: expected a throw, got none`);
    };

    delete process.env.RETENTION_BATCH_SIZE;
    delete process.env.RETENTION_MAX_BATCHES;
    check(
      "default batch size",
      readBoundedInt([], "--batch-size", "RETENTION_BATCH_SIZE", 1000),
      1000
    );

    process.env.RETENTION_BATCH_SIZE = "250";
    check(
      "env supplies batch size",
      readBoundedInt([], "--batch-size", "RETENTION_BATCH_SIZE", 1000),
      250
    );
    check(
      "flag beats env",
      readBoundedInt(["--batch-size", "7"], "--batch-size", "RETENTION_BATCH_SIZE", 1000),
      7
    );
    check(
      "absent flag falls back to env",
      readBoundedInt(["--apply"], "--batch-size", "RETENTION_BATCH_SIZE", 1000),
      250
    );

    process.env.RETENTION_MAX_BATCHES = "3";
    check(
      "flag beats env (max batches)",
      readBoundedInt(["--max-batches", "9"], "--max-batches", "RETENTION_MAX_BATCHES", 20),
      9
    );

    // A blank env var means "unset", not "zero": operators leave the line
    // commented or empty in env files far more often than they delete it.
    process.env.RETENTION_BATCH_SIZE = "  ";
    check(
      "blank env falls back to default",
      readBoundedInt([], "--batch-size", "RETENTION_BATCH_SIZE", 1000),
      1000
    );

    rejects("missing flag value", () =>
      readBoundedInt(["--batch-size"], "--batch-size", "RETENTION_BATCH_SIZE", 1000)
    );
    rejects("zero flag value", () =>
      readBoundedInt(["--batch-size", "0"], "--batch-size", "RETENTION_BATCH_SIZE", 1000)
    );
    rejects("negative flag value", () =>
      readBoundedInt(["--batch-size", "-5"], "--batch-size", "RETENTION_BATCH_SIZE", 1000)
    );
    rejects("non-integer flag value", () =>
      readBoundedInt(["--batch-size", "1.5"], "--batch-size", "RETENTION_BATCH_SIZE", 1000)
    );
    rejects("flag swallows next flag", () =>
      readBoundedInt(["--batch-size", "--json"], "--batch-size", "RETENTION_BATCH_SIZE", 1000)
    );
    rejects("garbage env value", () => {
      process.env.RETENTION_BATCH_SIZE = "lots";
      return readBoundedInt([], "--batch-size", "RETENTION_BATCH_SIZE", 1000);
    });

    console.log("[db-retention] SELF-TEST PASS - flag/env/default precedence verified.");
  } finally {
    for (const key of Object.keys(envBackup)) delete process.env[key];
    Object.assign(process.env, envBackup);
  }
}

/**
 * Only run the CLI when this file is the process entry point, so the self-test
 * can import and exercise the argument handling without opening a database.
 */
const invokedDirectly = /scripts[\\/]db-retention\.[cm]?[jt]s$/.test(
  (process.argv[1] ?? "").replace(/\\/g, "/")
);

if (invokedDirectly) {
  if (process.argv.includes("--self-test")) {
    runSelfTest();
  } else {
    main()
      .then((code) => {
        process.exitCode = code;
      })
      .catch((error: unknown) => {
        console.error("retention run failed:", error instanceof Error ? error.message : error);
        process.exitCode = 1;
      });
  }
}
