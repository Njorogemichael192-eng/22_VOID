/**
 * Server-side repository selection for the dashboard pages (Phase 13).
 *
 * `DASHBOARD_SOURCE=demo` forces the deterministic in-memory seed (CI/e2e);
 * otherwise the Prisma-backed repo is used when DATABASE_URL is configured,
 * and the demo seed is the fallback so the flow works on a fresh checkout.
 */

import { createApiRepo } from "@22void/db";
import type { ApiRepo } from "@22void/db";

import { createDemoRepo } from "./demo-repo";

export function serverDashboardRepo(): ApiRepo {
  if (process.env.DASHBOARD_SOURCE === "demo") {
    return createDemoRepo();
  }
  if (process.env.DATABASE_URL !== undefined && process.env.DATABASE_URL.length > 0) {
    return createApiRepo();
  }
  return createDemoRepo();
}

export function dashboardSourceLabel(): string {
  return process.env.DASHBOARD_SOURCE === "demo" ||
    process.env.DATABASE_URL === undefined ||
    process.env.DATABASE_URL.length === 0
    ? "demo"
    : "live";
}
