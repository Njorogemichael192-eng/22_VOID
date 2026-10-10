/**
 * 22_VOID cross-provider event reconciliation (Phase 19 Step 4).
 *
 * Folds historical duplicate canonical events — the same match created once per
 * provider before the alias dictionary knew their spellings — into one event
 * carrying both providers' source bindings. Defaults to a dry run: it prints
 * exactly what would move and writes nothing.
 *
 * Usage:
 *   DATABASE_URL=<url> npm run db:reconcile-events                      # dry run
 *   DATABASE_URL=<url> npm run db:reconcile-events -- --apply --yes     # write
 *   npm run db:reconcile-events -- --json
 *   npm run db:reconcile-events -- --max-merges 5
 *
 * Applying requires BOTH --apply and --yes. The merge is not cleanly reversible
 * (bindings move onto the winner and the loser row is deleted), so the second
 * flag is deliberate friction: take a dump first.
 */

import { applyReconcilePlan, createPrismaClient, loadReconcileEvents } from "@22void/db";
import type { ReconcileApplyResult } from "@22void/db";
import { planEventReconcile } from "@22void/normalization";
import type { ReconcilePlan } from "@22void/normalization";

export interface CliOptions {
  apply: boolean;
  yes: boolean;
  json: boolean;
  maxMerges?: number;
}

/** Parse argv into options. Throws on unknown flags or malformed values. */
export function resolveCliOptions(argv: readonly string[]): CliOptions {
  const options: CliOptions = { apply: false, yes: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--apply":
        options.apply = true;
        break;
      case "--yes":
        options.yes = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--max-merges": {
        const raw = argv[index + 1];
        if (raw === undefined || raw.startsWith("--")) {
          throw new Error("--max-merges requires a positive integer value");
        }
        const value = Number(raw);
        if (!Number.isInteger(value) || value <= 0) {
          throw new Error(`--max-merges must be a positive integer, got ${JSON.stringify(raw)}`);
        }
        options.maxMerges = value;
        index += 1;
        break;
      }
      default:
        throw new Error(`unknown argument ${JSON.stringify(arg)}`);
    }
  }
  return options;
}

interface Report {
  mode: "DRY RUN" | "APPLY";
  eventCountBefore: number;
  eventCountAfter: number;
  plan: ReconcilePlan;
  result: ReconcileApplyResult;
}

function printReport(report: Report): void {
  const { plan, result } = report;
  console.log("");
  console.log(`  mode                  ${report.mode}`);
  console.log(`  events                ${report.eventCountBefore} -> ${report.eventCountAfter}`);
  console.log(`  cross-provider folds  ${plan.merges.length}`);
  console.log(`  uncertain (held)      ${plan.uncertain.length}`);
  console.log(`  standalone            ${plan.standalone.length}`);
  console.log("");
  console.log(
    "  " +
      "winner".padEnd(46) +
      "loser".padEnd(46) +
      "score".padEnd(7) +
      "src".padEnd(4) +
      "mkt".padEnd(4) +
      "opp".padEnd(4) +
      "epi".padEnd(4) +
      "ms".padEnd(6) +
      "status"
  );
  for (const outcome of result.outcomes) {
    const score =
      plan.merges.find((m) => m.loserCanonicalEventId === outcome.loserCanonicalEventId)?.score ??
      0;
    console.log(
      "  " +
        outcome.winnerCanonicalEventId.padEnd(46) +
        outcome.loserCanonicalEventId.padEnd(46) +
        score.toFixed(2).padEnd(7) +
        String(outcome.sourceEventIds).padEnd(4) +
        String(outcome.markets).padEnd(4) +
        String(outcome.opportunities).padEnd(4) +
        String(outcome.episodes).padEnd(4) +
        String(outcome.durationMs).padEnd(6) +
        outcome.status +
        (outcome.error ? ` (${outcome.error})` : "")
    );
  }
  console.log("");
  console.log(
    `  ${report.mode === "DRY RUN" ? "would fold" : "folded"}: ${result.requested}  failed: ${result.failed}`
  );
  if (report.mode === "DRY RUN") {
    console.log("  Dry run: nothing was written. Re-run with --apply --yes to fold.");
  }
  if (plan.uncertain.length > 0) {
    console.log("");
    console.log("  Uncertain near-matches (NOT folded, need review):");
    for (const item of plan.uncertain) {
      console.log(
        `    ${item.canonicalEventId} ~ ${item.againstCanonicalEventId} (score ${item.score}) ${item.reasons.join("; ")}`
      );
    }
  }
  console.log("");
}

async function main(): Promise<number> {
  const databaseUrl = (process.env.DATABASE_URL ?? "").trim();
  if (databaseUrl === "") {
    console.error("DATABASE_URL is required");
    return 1;
  }

  const options = resolveCliOptions(process.argv.slice(2));
  if (options.apply && !options.yes) {
    console.error(
      "Refusing to apply: --apply also requires --yes (folds are not cleanly reversible).\n" +
        "Run without --apply for a dry run, take a dump, then re-run with --apply --yes."
    );
    return 2;
  }

  const db = createPrismaClient(databaseUrl);
  try {
    const events = await loadReconcileEvents(db);
    const plan = planEventReconcile(events);
    const result = await applyReconcilePlan(db, plan, {
      dryRun: !options.apply,
      ...(options.maxMerges !== undefined ? { maxMerges: options.maxMerges } : {}),
    });

    const settled = result.outcomes.filter((outcome) => outcome.status !== "failed").length;
    const report: Report = {
      mode: options.apply ? "APPLY" : "DRY RUN",
      eventCountBefore: events.length,
      eventCountAfter: options.apply ? events.length - settled : events.length - result.requested,
      plan,
      result,
    };

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printReport(report);
    }
    return result.failed > 0 ? 1 : 0;
  } finally {
    await db.$disconnect();
  }
}

/** Self-test for argument parsing, run via `--self-test`. No database needed. */
export function runSelfTest(): void {
  const check = (label: string, actual: unknown, expected: unknown): void => {
    if (actual !== expected) {
      throw new Error(
        `[reconcile-events] SELF-TEST FAIL - ${label}: expected ${String(expected)}, got ${String(actual)}`
      );
    }
  };
  const rejects = (label: string, argv: readonly string[]): void => {
    let threw = false;
    try {
      resolveCliOptions(argv);
    } catch {
      threw = true;
    }
    if (!threw) {
      throw new Error(`[reconcile-events] SELF-TEST FAIL - ${label}: expected a throw`);
    }
  };

  const plain = resolveCliOptions([]);
  check("default apply", plain.apply, false);
  check("default yes", plain.yes, false);
  check("default json", plain.json, false);
  check("default maxMerges", plain.maxMerges, undefined);

  const applied = resolveCliOptions(["--apply", "--yes", "--json", "--max-merges", "7"]);
  check("apply", applied.apply, true);
  check("yes", applied.yes, true);
  check("json", applied.json, true);
  check("max-merges value", applied.maxMerges, 7);

  rejects("unknown flag", ["--nope"]);
  rejects("missing max-merges value", ["--max-merges"]);
  rejects("flag as max-merges value", ["--max-merges", "--apply"]);
  rejects("zero max-merges", ["--max-merges", "0"]);
  rejects("negative max-merges", ["--max-merges", "-3"]);
  rejects("non-integer max-merges", ["--max-merges", "1.5"]);

  console.log("[reconcile-events] SELF-TEST PASS - argument parsing verified.");
}

/**
 * Only run the CLI when this file is the process entry point, so the self-test
 * can import the argument handling without opening a database.
 */
const invokedDirectly = /scripts[\\/]reconcile-events\.[cm]?[jt]s$/.test(
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
        console.error("reconcile run failed:", error instanceof Error ? error.message : error);
        process.exitCode = 1;
      });
  }
}
