/**
 * scripts/secret-scan.ts
 *
 * Phase 18 — dependency/secret hygiene. Scans tracked and untracked,
 * non-ignored files for accidentally exposed secrets:
 *
 *   1. Known vendor credential shapes (GitHub/AWS/Stripe/Slack/npm/OpenAI…).
 *   2. Private key blocks.
 *   3. Env-var assignments for secret-suffixed names whose value does not look
 *      like the documented placeholder (Phase 1 `.env.example` convention).
 *   4. Provider API key values near PARLAY_API_KEY or ODDS_API_KEY names.
 *
 * The file list comes from `git ls-files --cached --others --exclude-standard`,
 * so gitignored local `.env` files are never read. Findings print only
 * `file:line`, a reason, and a redaction marker. False positives should be fixed
 * by removing the value, not by whitelisting the file.
 */

import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";

const EXCLUDED_FILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "npm-shrinkwrap.json",
]);

/** Values that are clearly documentation placeholders, not secrets. */
const PLACEHOLDER_ATOMS = [
  "<",
  ">",
  "your-",
  "your_",
  "example",
  "changeme",
  "localhost",
  "127.0.0.1",
  "void_dev_password",
  "fieldValue",
  "change-me",
  "replace-me",
  "not-a-real",
];

interface Pattern {
  name: string;
  re: RegExp;
}

const VENDOR_PATTERNS: Pattern[] = [
  { name: "GitHub classic PAT", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { name: "GitHub fine-grained PAT", re: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g },
  { name: "Stripe secret key", re: /\bsk_live_[0-9A-Za-z]{24,}\b/g },
  { name: "OpenAI/Anthropic-style secret", re: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { name: "Slack bot token", re: /\bxoxb-[A-Za-z0-9-]{10,}\b/g },
  { name: "Slack webhook URL", re: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/g },
  { name: "AWS access key id", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "npm registry token", re: /\bnpm_[A-Za-z0-9]{36,}\b/g },
  { name: "SendGrid API key", re: /\bSG\.[A-Za-z0-9_-]{20,}\b/g },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "GitLab personal access token", re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { name: "Telegram bot token", re: /\b\d{9,10}:[A-Za-z0-9_-]{35}\b/g },
  { name: "private key block", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g },
];

/**
 * Separator between a provider-key name and its value: an optional `is`/`was`
 * connector plus punctuation, whitespace and quoting characters. Deliberately
 * excludes alphanumerics so the captured value always starts a fresh run.
 */
const KEY_VALUE_GAP = "(?:\\s+)?(?:is|was|were)?[\\s(\\[\\{`'\":=,]*";

const PROVIDER_PATTERNS: Pattern[] = [
  {
    name: "provider API key near PARLAY_API_KEY",
    re: new RegExp(`\\bPARLAY_API_KEY\\b${KEY_VALUE_GAP}([A-Za-z0-9]{24,})\\b`, "gi"),
  },
  {
    name: "provider API key near ODDS_API_KEY",
    re: new RegExp(`\\bODDS_API_KEY\\b${KEY_VALUE_GAP}([A-Za-z0-9]{24,})\\b`, "gi"),
  },
  {
    name: "provider API key named as ParlayAPI key in prose",
    re: new RegExp(
      `\\bParlay[\\s_-]?API[\\s_-]?key\\b${KEY_VALUE_GAP}([A-Za-z0-9]{24,})\\b`,
      "gi"
    ),
  },
  {
    name: "provider API key named as Odds API key in prose",
    re: new RegExp(
      `\\b(?:the\\s+)?Odds[\\s_-]?API[\\s_-]?key\\b${KEY_VALUE_GAP}([A-Za-z0-9]{24,})\\b`,
      "gi"
    ),
  },
];

const SECRET_NAME_RE = /(KEY|TOKEN|SECRET|PASSWORD|PASS|AUTH|CREDENTIAL)/;

/** Well-known non-secret environment names with secret-ish suffixes. */
const ALLOWED_ASSIGNMENT_VARS = new Set(["API_KEY_HEADER", "API_KEY_HEADER_DESCRIPTION"]);

const ASSIGN_PATTERN = /^[ \t]*([A-Z][A-Z0-9_]{3,})[ \t]*[:=][ \t]*['"]?([^'"\s]{8,})['"]?[ \t]*$/;

interface Finding {
  file: string;
  line: number;
  reason: string;
}

function looksPlaceholder(text: string, value: string): boolean {
  const normalized = value.toLowerCase();
  if (PLACEHOLDER_ATOMS.some((atom) => normalized.includes(atom.toLowerCase()))) return true;
  return (
    text.trim().startsWith("#") ||
    /(example|sample|placeholder|dummy|replace|your[-_ ])/i.test(normalized)
  );
}

function lineNumberAt(content: string, index: number): number {
  return content.slice(0, index).split(/\r?\n/).length;
}

function collectFiles(): string[] {
  const out = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8" }
  );
  return out.split("\0").filter((file) => {
    if (file.length === 0 || EXCLUDED_FILES.has(file)) return false;
    try {
      return lstatSync(file).isFile();
    } catch {
      return false;
    }
  });
}

export function scanContent(file: string, content: string): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split(/\r?\n/);

  for (const pattern of VENDOR_PATTERNS) {
    pattern.re.lastIndex = 0;
    for (const match of content.matchAll(pattern.re)) {
      findings.push({
        file,
        line: lineNumberAt(content, match.index),
        reason: pattern.name,
      });
    }
  }

  for (const pattern of PROVIDER_PATTERNS) {
    pattern.re.lastIndex = 0;
    for (const match of content.matchAll(pattern.re)) {
      const value = match[1] ?? "";
      if (looksPlaceholder(match[0], value)) continue;
      findings.push({
        file,
        line: lineNumberAt(content, match.index),
        reason: pattern.name,
      });
    }
  }

  lines.forEach((raw, idx) => {
    const lineNo = idx + 1;
    const line = raw.trim();
    const envMatch = ASSIGN_PATTERN.exec(line);
    if (envMatch === null) return;
    const [, name, value] = envMatch as unknown as [string, string, string];
    if (!SECRET_NAME_RE.test(name)) return;
    if (ALLOWED_ASSIGNMENT_VARS.has(name)) return;
    if (looksPlaceholder(raw, value)) return;
    if (/[A-Za-z0-9+/]{24,}/.test(value)) {
      findings.push({
        file,
        line: lineNo,
        reason: `environment variable ${name} carries a non-placeholder value`,
      });
    }
  });

  return findings;
}

function runSelfTest(): void {
  const secret = "a1".repeat(16);
  const cases: Array<[string, string, string]> = [
    [
      "PARLAY_API_KEY is",
      `Runbook prose says PARLAY_API_KEY is \`${secret}\`; rotate it.`,
      "near PARLAY_API_KEY",
    ],
    [
      "ParlayAPI key (",
      `The leaked ParlayAPI key (\`${secret}\`, committed earlier) must be rotated.`,
      "ParlayAPI key in prose",
    ],
    [
      "a real ParlayAPI key",
      `A real ParlayAPI key (\`${secret}\`) was found committed.`,
      "ParlayAPI key in prose",
    ],
    [
      "PARLAY_API_KEY=",
      `PARLAY_API_KEY=\`${secret}\` appears in the changelog.`,
      "near PARLAY_API_KEY",
    ],
    ["ODDS_API_KEY is", `ODDS_API_KEY is \`${secret}\``, "near ODDS_API_KEY"],
    [
      "The Odds API key",
      `The Odds API key (\`${secret}\`) was leaked.`,
      "Odds API key in prose",
    ],
    [
      "ODDS_API_KEY=",
      `ODDS_API_KEY=\`${secret}\` was pasted into a log.`,
      "near ODDS_API_KEY",
    ],
  ];
  for (const [label, line, expectedReason] of cases) {
    const findings = scanContent("self-test", line);
    if (!findings.some((finding) => finding.reason.includes(expectedReason))) {
      throw new Error(`[secret-scan] SELF-TEST FAIL — provider detection for ${label}`);
    }
    if (JSON.stringify(findings).includes(secret)) {
      throw new Error(`[secret-scan] SELF-TEST FAIL — provider value was not redacted for ${label}`);
    }
  }

  const benign = [
    "ParlayAPI key rotation is required at the provider.",
    "Odds API key must be provisioned before deploy.",
    "PARLAY_API_KEY rotation recorded in the provider evaluation.",
    "ODDS_API_KEY is server-side only.",
  ];
  for (const line of benign) {
    if (scanContent("self-test", line).length !== 0) {
      throw new Error(`[secret-scan] SELF-TEST FAIL — prose false positive on: ${line}`);
    }
  }

  const placeholder = "replace".repeat(8);
  if (scanContent("self-test", `ODDS_API_KEY=${placeholder}`).length !== 0) {
    throw new Error("[secret-scan] SELF-TEST FAIL — placeholder was not ignored");
  }
  console.log("[secret-scan] SELF-TEST PASS — provider prose/backtick detection verified.");
}

function main(): void {
  const files = collectFiles();
  let findings: Finding[] = [];
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    findings = findings.concat(scanContent(file, content));
  }

  if (findings.length > 0) {
    console.error(
      "[secret-scan] FAIL — potential secrets in tracked or untracked non-ignored files:"
    );
    for (const finding of findings) {
      console.error(`  ${finding.file}:${finding.line}: ${finding.reason} — [REDACTED]`);
    }
    console.error(
      "[secret-scan] Rotate any leaked credential and remove the value (do not whitelist)."
    );
    process.exit(1);
  }

  console.log(
    `[secret-scan] PASS — scanned ${files.length} tracked and untracked non-ignored files, no secrets found.`
  );
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  main();
}
