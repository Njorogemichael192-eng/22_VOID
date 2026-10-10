/**
 * 22_VOID cross-provider market reconciliation (Phase 19 Step 5).
 *
 * Folds historical duplicate canonical markets — the same within-event market
 * structure persisted once per provider before the canonical market key existed
 * — into one Market row carrying both providers' source identities. Defaults to
 * a dry run: it prints exactly what would move and writes nothing.
 *
 * Usage:
 *   DATABASE_URL=<url> npm run db:reconcile-markets                      # dry run
 *   DATABASE_URL=<url> npm run db:reconcile-markets -- --apply --yes     # write
 *   npm run db:reconcile-markets -- --json
 *   npm run db:reconcile-markets -- --max-merges 5
 *
 * Applying requires BOTH --apply and --yes. The merge is not cleanly reversible
 * (selections and source identities move onto the winner and the loser row is
 * deleted), so the second flag is deliberate friction: take a dump first.
 */

import { applyMarketReconcilePlan, createPrismaClient, loadReconcileMarkets } from "@22void/db";
import type { ReconcileMarketApplyResult } from "@22void/db";
import { planMarketReconcile } from "@22void/normalization";
import type { ReconcileMarketPlan } from "@22void/normalization";

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
        const value = argv[index + 1];
        if (value === undefined || value.startsWith("--")) {
          throw new Error("--max-merges requires a value");
        }
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          throw new Error(`--max-merges must be a positive integer (got ${JSON.stringify(value)})`);
        }
        options.maxMerges = parsed;
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
  markets: number;
  folds: number;
  plan: ReconcileMarketPlan;
  result: ReconcileMarketApplyResult;
}

function printReport(report: Report): void {
  const { plan, result } = report;
  console.log("");
  console.log(`  mode                  ${report.mode}`);
  console.log(`  markets               ${report.markets}`);
  console.log(`  canonical folds       ${plan.merges.length}`);
  console.log(`  standalone            ${plan.standalone.length}`);
  console.log("");
  if (plan.merges.length > 0) {
    console.log("  winner -> loser (canonical event / structure)");
    for (const merge of plan.merges) {
      console.log(
        `    ${merge.winnerMarketId} (${merge.winnerProvider}) <- ${merge.loserMarketId} (${merge.loserProvider}) [${merge.canonicalMarketId}]`
      );
    }
    console.log("");
  }
  console.log(`  planned=${result.requested} applied=${result.applied} failed=${result.failed}`);
  for (const outcome of result.outcomes) {
    const counts = `${outcome.marketSourceIds} src, ${outcome.selections} sel, ${outcome.droppedSelections} dropped`;
    console.log(
      `    ${outcome.status.padEnd(8)} ${outcome.winnerMarketId} <- ${outcome.loserMarketId} (${counts}, ${outcome.durationMs}ms)${outcome.error ? ` ERROR: ${outcome.error}` : ""}`
    );
  }
  console.log("");
}

async function main(argv: readonly string[]): Promise<void> {
  const options = resolveCliOptions(argv);
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error("DATABASE_URL is required");
  }
  if (options.apply && !options.yes) {
    throw new Error("refusing to apply without --yes (folds are not cleanly reversible)");
  }

  const db = createPrismaClient(url);
  try {
    const markets = await loadReconcileMarkets(db);
    const plan = planMarketReconcile(markets);
    const result = await applyMarketReconcilePlan(db, plan, {
      dryRun: !options.apply,
      ...(options.maxMerges !== undefined ? { maxMerges: options.maxMerges } : {}),
    });
    const report: Report = {
      mode: options.apply ? "APPLY" : "DRY RUN",
      markets: markets.length,
      folds: plan.merges.length,
      plan,
      result,
    };
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printReport(report);
    }
    if (result.failed > 0) process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

/** Self-test for argument parsing, run via `--self-test`. No database needed. */
export function runSelfTest(): void {
  const check = (label: string, actual: unknown, expected: unknown): void => {
    if (actual !== expected) {
      throw new Error(
        `[reconcile-markets] SELF-TEST FAIL - ${label}: expected ${String(expected)}, got ${String(actual)}`
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
      throw new Error(`[reconcile-markets] SELF-TEST FAIL - ${label}: expected a throw`);
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

  console.log("[reconcile-markets] SELF-TEST PASS - argument parsing verified.");
}

const invokedDirectly = /reconcile-markets\.[cm]?[jt]s$/.test(
  (process.argv[1] ?? "").replace(/\\/g, "/")
);

if (invokedDirectly) {
  if (process.argv.includes("--self-test")) {
    runSelfTest();
  } else {
    main(process.argv.slice(2)).catch((error: unknown) => {
      console.error("market reconcile failed:", error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
  }
}
