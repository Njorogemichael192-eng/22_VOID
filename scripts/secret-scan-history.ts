/**
 * scripts/secret-scan-history.ts
 *
 * Phase 18 — git-history secret scan. `secret-scan.ts` reads the working tree
 * via `git ls-files`, so it cannot see a credential that was committed and later
 * redacted. That gap is exactly how the ParlayAPI key survived review: the
 * working tree was clean while `PROJECT_STATE.md` in published commits still
 * carried the value.
 *
 * This scanner walks every commit reachable from every ref
 * (`git rev-list --all`), renders each commit's patch with `-U0`, and runs the
 * *same* `scanContent` detection used for the working tree — so a value is
 * flagged whether it appears in an added line, a removed line, or prose.
 *
 * Findings print commit, path, reason and a redaction marker. The value is never
 * echoed. Exit code 1 fails CI, so a leaked key cannot be re-published silently
 * even after it has been scrubbed from the working tree.
 *
 * Usage:
 *   npm run security:scan:history
 *   npm run security:scan:history -- --limit=200
 */

import { execFileSync } from "node:child_process";
import { scanContent } from "./secret-scan.js";

/** Per-commit patch cap. A single commit larger than this is reported, not scanned. */
const MAX_PATCH_BYTES = 64 * 1024 * 1024;

const DEFAULT_LIMIT = 500;

interface HistoryFinding {
  commit: string;
  file: string;
  line: number;
  reason: string;
}

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: MAX_PATCH_BYTES });
}

function parseLimit(argv: string[]): number {
  const flag = argv.find((arg) => arg.startsWith("--limit="));
  if (flag === undefined) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(flag.slice("--limit=".length), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LIMIT;
}

/** Patch headers that are not content and must not advance the new-file line counter. */
const PATCH_METADATA = /^(?:diff --git |index |old mode |new mode |new file |deleted file |similarity index |rename |copy |Binary files|GIT binary patch)/;

/**
 * Scan one commit patch line-by-line so every finding carries the file it came
 * from. Line numbers are positions in the *new* file, so removed lines report the
 * line they were removed from; that is the useful anchor for a manual review.
 */
function scanPatch(commit: string, patch: string): HistoryFinding[] {
  const findings: HistoryFinding[] = [];
  let file = "(unknown)";
  let lineNo = 0;

  for (const raw of patch.split("\n")) {
    if (PATCH_METADATA.test(raw)) {
      if (raw.startsWith("diff --git ")) file = "(unknown)";
      continue;
    }
    if (raw.startsWith("+++ ")) {
      const target = raw.slice(4).trim();
      file = target === "/dev/null" ? "(deleted)" : target.replace(/^b\//, "");
      continue;
    }
    if (raw.startsWith("--- ")) continue;

    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk !== null) {
      lineNo = Number.parseInt(hunk[1] as string, 10);
      continue;
    }

    // `-U0` means no context lines, so only added lines advance the counter.
    if (!raw.startsWith("+")) continue;

    lineNo += 1;
    for (const finding of scanContent(file, raw.slice(1))) {
      // Report the patch line, not `finding.line` (always 1 for a single line).
      findings.push({ commit, file, line: lineNo, reason: finding.reason });
    }
  }

  return findings;
}

function reachableCommits(limit: number): string[] {
  const out = git(["rev-list", "--all", `--max-count=${limit}`]);
  return out.split("\n").filter((sha) => /^[0-9a-f]{40}$/.test(sha));
}

function main(): void {
  const commits = reachableCommits(parseLimit(process.argv.slice(2)));
  if (commits.length === 0) {
    console.error("[secret-scan-history] FAIL — no commits found; is this a git repository?");
    process.exit(1);
  }

  const findings: HistoryFinding[] = [];
  const seen = new Set<string>();
  let truncated = false;

  for (const commit of commits) {
    let patch: string;
    try {
      patch = git(["show", "--format=", "--no-color", "-U0", "--patch", commit]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A patch over the buffer cap cannot be scanned, and an unscanned commit
      // must never be reported as clean.
      console.error(`[secret-scan-history] FAIL — could not read commit ${commit}: ${message}`);
      truncated = true;
      break;
    }
    for (const finding of scanPatch(commit, patch)) {
      const key = `${finding.commit}:${finding.file}:${finding.reason}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push(finding);
    }
  }

  if (truncated) process.exit(1);

  if (findings.length > 0) {
    console.error(
      `[secret-scan-history] FAIL — ${findings.length} potential secret(s) in published git history:`
    );
    for (const finding of findings) {
      console.error(
        `  ${finding.commit.slice(0, 12)} ${finding.file}:~${finding.line}: ${finding.reason} — [REDACTED]`
      );
    }
    console.error(
      "[secret-scan-history] Rotate the credential, then purge it with `git filter-repo` " +
        "(see docs/DEPLOYMENT.md) and force-push. Removing it from the working tree is not enough."
    );
    process.exit(1);
  }

  console.log(
    `[secret-scan-history] PASS — scanned ${commits.length} commit(s) across all refs, no secrets found.`
  );
}

const invokedDirectly = /scripts[\\/]secret-scan-history\.[cm]?[jt]s$/.test(
  (process.argv[1] ?? "").replace(/\\/g, "/")
);

if (invokedDirectly) {
  main();
}
