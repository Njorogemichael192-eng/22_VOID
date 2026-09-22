/**
 * Snapshot queries for the overview page (Phase 13). Thin, repo-injected
 * facade so the dashboard pages stay declarative and tests can drive them with
 * the demo repo or a fake.
 */

import { OpportunityStatus } from "@22void/domain";
import type { ApiRepo, OpportunityView, ProviderView } from "@22void/db";

import { summarizeScanner, type ScannerSummary } from "./metrics";

export interface DashboardSnapshot {
  verified: OpportunityView[];
  recent: OpportunityView[];
  providers: ProviderView[];
  scanner: ScannerSummary;
  generatedAt: number;
}

export async function getDashboardSnapshot(
  repo: ApiRepo,
  now: number = Date.now()
): Promise<DashboardSnapshot> {
  const [verifiedPage, recentPage, providers, runs] = await Promise.all([
    repo.listOpportunities({ status: OpportunityStatus.VERIFIED_ARB, cursor: null, limit: 12 }),
    repo.listOpportunities({ cursor: null, limit: 8 }),
    repo.listProviders(),
    repo.listScannerRuns(50),
  ]);
  return {
    verified: verifiedPage.data,
    recent: recentPage.data,
    providers,
    scanner: summarizeScanner(runs, now),
    generatedAt: now,
  };
}
