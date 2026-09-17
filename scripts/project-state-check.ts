/**
 * scripts/project-state-check.ts
 *
 * Validates the structure of PROJECT_STATE.md:
 *  - required headings exist
 *  - status markers are valid ([ ] / [~] / [x] / [!] / [?])
 *  - exactly one CURRENT PHASE and one NEXT ACTION are declared
 *  - a CHANGELOG section exists with entries
 *
 * Exits non-zero when any rule fails so CI can run it as a gate.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const STATE_PATH = resolve(ROOT, "PROJECT_STATE.md");

const REQUIRED_HEADINGS = [
  "## STATUS",
  "## PHASE 0",
  "## CURRENT PHASE",
  "## NEXT ACTION",
  "## CHANGELOG",
];

const VALID_MARKERS = new Set(["[ ]", "[~]", "[x]", "[!]", "[?]"]);

interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

function hasHeading(md: string, heading: string): boolean {
  return md.split(/\r?\n/).some((line) => line.trim().startsWith(heading));
}

function sectionBody(lines: string[], heading: string): string[] {
  const idx = lines.findIndex((l) => l.trim().startsWith(heading));
  if (idx === -1) return [];
  const out: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^\s*##\s/.test(l)) break;
    out.push(l);
  }
  return out;
}

function validate(md: string): CheckResult[] {
  const results: CheckResult[] = [];
  const lines = md.split(/\r?\n/);

  for (const heading of REQUIRED_HEADINGS) {
    results.push({
      name: `heading: ${heading}`,
      ok: hasHeading(md, heading),
      detail: hasHeading(md, heading) ? undefined : `${heading} missing`,
    });
  }

  const taskLines = lines.filter((l) => /^\s*- \[[ x~!?]\]/.test(l));
  const badMarker = taskLines.filter((l) => {
    const m = l.match(/^\s*- (\[[^\]]+\])/);
    return m ? !VALID_MARKERS.has(m[1]!) : false;
  });
  results.push({
    name: "status markers valid",
    ok: badMarker.length === 0,
    detail: badMarker.length ? `invalid markers: ${badMarker.join("; ")}` : undefined,
  });

  const currentPhaseBody = sectionBody(lines, "## CURRENT PHASE");
  const nextActionBody = sectionBody(lines, "## NEXT ACTION");

  results.push({
    name: "current phase declared",
    ok: currentPhaseBody.some((l) => l.trim() !== ""),
    detail: currentPhaseBody.some((l) => l.trim() !== "") ? undefined : "no CURRENT PHASE value",
  });
  results.push({
    name: "next action declared",
    ok: nextActionBody.some((l) => l.trim() !== ""),
    detail: nextActionBody.some((l) => l.trim() !== "") ? undefined : "no NEXT ACTION value",
  });

  const changes = sectionBody(lines, "## CHANGELOG").filter((l) => /^\s*- .+/.test(l));
  results.push({
    name: "changelog has entries",
    ok: changes.length > 0,
    detail: changes.length === 0 ? "no changelog entries found" : undefined,
  });

  return results;
}

function main(): void {
  let md: string;
  try {
    md = readFileSync(STATE_PATH, "utf8");
  } catch (err) {
    console.error(`[project-state-check] FAIL: cannot read ${STATE_PATH}: ${(err as Error).message}`);
    process.exit(1);
  }

  const results = validate(md);
  const failures = results.filter((r) => !r.ok);

  for (const r of results) {
    const tag = r.ok ? "ok  " : "FAIL";
    console.log(`[project-state-check] ${tag} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  }

  if (failures.length > 0) {
    console.error(`[project-state-check] ${failures.length} check(s) failed. Update PROJECT_STATE.md.`);
    process.exit(1);
  }

  console.log("[project-state-check] PASS");
}

main();