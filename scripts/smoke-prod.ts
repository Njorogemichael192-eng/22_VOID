/**
 * 22_VOID production smoke test (Phase 18).
 *
 * Probes a running deployment exactly as a live site visitor + operator would:
 * public liveness/readiness, protected API authentication, scanner health and
 * optional worker health.
 *
 * Usage:
 *   SMOKE_BASE_URL=http://127.0.0.1:3000 \
 *   SMOKE_API_KEY=<API_KEY for the target env> \
 *   SMOKE_REQUIRE_SCANNER=true \
 *   SMOKE_WORKER_URL=http://127.0.0.1:8081 \
 *   npm run smoke:prod
 */

const BASE_URL = (process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const API_KEY = (process.env.SMOKE_API_KEY ?? process.env.API_KEY ?? "").trim();
const REQUIRE_SCANNER = process.env.SMOKE_REQUIRE_SCANNER === "true";
const WORKER_URL = (process.env.SMOKE_WORKER_URL ?? "").trim();
const STALE_RUN_MS = 5 * 60 * 1000;

interface JsonResult {
  status: number;
  body: unknown;
}

interface ScannerPayload {
  data?: unknown[];
  overall?: {
    status?: string;
    stale?: unknown;
    lastRunAt?: string | null;
  };
}

const failures: string[] = [];
const warnings: string[] = [];

function record(label: string, ok: boolean, detail = ""): void {
  const mark = ok ? "PASS" : "FAIL";
  console.log(`  [${mark}] ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

async function getJson(url: string, headers: Record<string, string> = {}): Promise<JsonResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    const text = await response.text();
    let body: unknown;
    try {
      body = text === "" ? null : JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: response.status, body };
  } catch (error) {
    return { status: 0, body: String(error) };
  } finally {
    clearTimeout(timer);
  }
}

function bodyStatus(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const status = (body as { status?: unknown }).status;
  return typeof status === "string" ? status : null;
}

function requestDetail(result: JsonResult): string {
  if (result.status === 0) return String(result.body);
  const status = bodyStatus(result.body);
  return status === null ? `HTTP ${result.status}` : `HTTP ${result.status}, status=${status}`;
}

function workerHealthUrl(): string | null {
  if (WORKER_URL === "") return null;
  const normalized = WORKER_URL.replace(/\/+$/, "");
  return normalized.endsWith("/healthz") ? normalized : `${normalized}/healthz`;
}

function checkScannerHealth(now: number, overall: ScannerPayload["overall"]): void {
  if (overall === undefined || overall === null) {
    record("scanner response includes `overall`", false, "payload missing overall block");
    return;
  }

  const scannerStatus = overall.status ?? "missing";
  record(
    "scanner overall.status is HEALTHY",
    scannerStatus === "HEALTHY",
    `status=${scannerStatus}`
  );

  const stale = overall.stale;
  const hasStaleMarker = stale !== null && stale !== undefined;
  record(
    "scanner stale marker is null",
    !hasStaleMarker,
    hasStaleMarker ? JSON.stringify(stale) : ""
  );

  const lastRunAt = overall.lastRunAt ?? null;
  if (lastRunAt === null) {
    if (REQUIRE_SCANNER) {
      record("scanner has produced a run", false, "no scanner run found in DB");
    } else {
      warnings.push("no scanner run recorded yet (worker idle or demo stack) — skipped");
      console.log(
        "  [SKIP] scanner freshness (no run found; set SMOKE_REQUIRE_SCANNER=true to enforce)"
      );
    }
    return;
  }

  const at = Date.parse(lastRunAt);
  if (Number.isNaN(at)) {
    record("scanner lastRunAt is a valid timestamp", false, `got "${lastRunAt}"`);
    return;
  }
  const ageMin = Math.round((now - at) / 1000 / 60);
  const fresh = now - at <= STALE_RUN_MS;
  record("scanner run is fresh (< 5 min)", fresh, `${lastRunAt} (${ageMin} min old)`);
}

async function main(): Promise<void> {
  console.log(`22_VOID production smoke — ${BASE_URL}`);
  if (REQUIRE_SCANNER) {
    console.log("  scanner health enabled (SMOKE_REQUIRE_SCANNER=true)");
  }
  console.log("");

  const now = Date.now();

  const health = await getJson(`${BASE_URL}/api/v1/health`);
  record(
    "GET /api/v1/health -> 200 ok",
    health.status === 200 && bodyStatus(health.body) === "ok",
    requestDetail(health)
  );

  const readiness = await getJson(`${BASE_URL}/api/v1/ready`);
  record(
    "GET /api/v1/ready -> 200 ok",
    readiness.status === 200 && bodyStatus(readiness.body) === "ok",
    requestDetail(readiness)
  );

  if (REQUIRE_SCANNER && API_KEY === "") {
    record(
      "scanner API key is configured",
      false,
      "set SMOKE_API_KEY or API_KEY when SMOKE_REQUIRE_SCANNER=true"
    );
  }

  const noAuth = await getJson(`${BASE_URL}/api/v1/scanner`);
  record("scanner without key -> 401", noAuth.status === 401, `HTTP ${noAuth.status}`);

  const bogus = await getJson(`${BASE_URL}/api/v1/scanner`, {
    "x-api-key": "not-a-real-key",
  });
  record("scanner with bogus key -> 401", bogus.status === 401, `HTTP ${bogus.status}`);

  let scanner: ScannerPayload | null = null;
  if (API_KEY === "") {
    if (!REQUIRE_SCANNER) {
      warnings.push("SMOKE_API_KEY unset — skipping authenticated scanner check");
      console.log("  [SKIP] authenticated scanner call (SMOKE_API_KEY unset)");
    }
  } else {
    const authed = await getJson(`${BASE_URL}/api/v1/scanner`, {
      "x-api-key": API_KEY,
    });
    const shape = authed.body as ScannerPayload | null;
    const shaped =
      typeof shape === "object" &&
      shape !== null &&
      Array.isArray(shape.data) &&
      typeof shape.overall === "object" &&
      shape.overall !== null;
    record(
      "scanner with valid key -> 200 + payload",
      authed.status === 200 && shaped,
      `HTTP ${authed.status}`
    );
    if (shaped) scanner = shape;
  }

  if (scanner !== null) {
    checkScannerHealth(now, scanner.overall);
  }

  const workerUrl = workerHealthUrl();
  if (workerUrl === null) {
    console.log("  [SKIP] worker health (SMOKE_WORKER_URL unset)");
  } else {
    const worker = await getJson(workerUrl);
    record(
      "worker health -> 200 ok",
      worker.status === 200 && bodyStatus(worker.body) === "ok",
      requestDetail(worker)
    );
  }

  console.log("");
  for (const warning of warnings) console.log(`  WARN: ${warning}`);
  console.log("");

  const failed = failures.length > 0;
  console.log(failed ? `SMOKE FAILED — ${failures.length} check(s)` : "SMOKE PASSED");
  process.exitCode = failed ? 1 : 0;
}

main().catch((error: unknown) => {
  console.error(`SMOKE ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
