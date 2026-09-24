/**
 * scripts/secret-scan.ts
 *
 * Phase 16 — dependency/secret hygiene. Scans the git-tracked tree for
 * accidentally committed secrets:
 *
 *   1. Known vendor credential shapes (GitHub/AWS/Stripe/Slack/npm/OpenAI…).
 *   2. Private key blocks.
 *   3. Env-var assignments for secret-suffixed names whose value does not look
 *      like the documented placeholder (Phase 1 `.env.example` convention).
 *
 * The scan runs over `git ls-files` only, so gitignored local `.env` files are
 * never read. Anything found prints `file:line` and exits non-zero so CI can
 * use it as a gate. False positives should be fixed by removing the value, not
 * by whitelisting the file.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

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
];

interface Pattern {
  name: string;
  re: RegExp;
}

const VENDOR_PATTERNS: Pattern[] = [
  { name: "GitHub classic PAT", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: "GitHub fine-grained PAT", re: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/ },
  { name: "Stripe secret key", re: /\bsk_live_[0-9A-Za-z]{24,}\b/ },
  { name: "OpenAI/Anthropic-style secret", re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: "Slack bot token", re: /\bxoxb-[A-Za-z0-9-]{10,}\b/ },
  { name: "Slack webhook URL", re: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/ },
  { name: "AWS access key id", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: "npm registry token", re: /\bnpm_[A-Za-z0-9]{36,}\b/ },
  { name: "SendGrid API key", re: /\bSG\.[A-Za-z0-9_-]{20,}\b/ },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "GitLab personal access token", re: /\bglpat-[A-Za-z0-9_-]{20,}\b/ },
  { name: "Telegram bot token", re: /\b\d{9,10}:[A-Za-z0-9_-]{35}\b/ },
  { name: "private key block", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/ },
];

const SECRET_NAME_RE = /(KEY|TOKEN|SECRET|PASSWORD|PASS|AUTH|CREDENTIAL)/;

/** Well-known non-secret environment names with secret-ish suffixes. */
const ALLOWED_ASSIGNMENT_VARS = new Set(["API_KEY_HEADER", "API_KEY_HEADER_DESCRIPTION"]);

const ASSIGN_PATTERN = /^[ \t]*([A-Z][A-Z0-9_]{3,})[ \t]*[:=][ \t]*['"]?([^'"\s]{8,})['"]?[ \t]*$/;

interface Finding {
  file: string;
  line: number;
  text: string;
  reason: string;
}

function looksPlaceholder(text: string, value: string): boolean {
  if (PLACEHOLDER_ATOMS.some((atom) => value.includes(atom))) return true;
  return text.trim().startsWith("#") || /(example|sample|placeholder|replace|your )/i.test(text.trim());
}

function collectTrackedFiles(): string[] {
  const out = execFileSync("git", ["ls-files"], { encoding: "utf8" });
  return out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !EXCLUDED_FILES.has(line));
}

export function scanContent(file: string, content: string): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split(/\r?\n/);

  for (const pattern of VENDOR_PATTERNS) {
    const match = pattern.re.exec(content);
    if (match !== null) {
      const lineNo = content.slice(0, match.index).split(/\r?\n/).length;
      findings.push({
        file,
        line: lineNo,
        text: match[0].slice(0, 80),
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
        text: value.slice(0, 24) + "…",
        reason: `environment variable ${name} carries a non-placeholder value`,
      });
    }
  });

  return findings;
}

function main(): void {
  const files = collectTrackedFiles();
  let findings: Finding[] = [];
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    findings = findings.concat(scanContent(file, content));
  }

  if (findings.length > 0) {
    console.error("[secret-scan] FAIL — potential secrets in tracked files:");
    for (const finding of findings) {
      console.error(
        `  ${finding.file}:${finding.line}: ${finding.reason} — "${finding.text}"`,
      );
    }
    console.error("[secret-scan] Rotate any leaked credential and remove the value (do not whitelist).");
    process.exit(1);
  }

  console.log(`[secret-scan] PASS — scanned ${files.length} tracked files, no secrets found.`);
}

main();