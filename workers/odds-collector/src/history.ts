/**
 * Historical reconciliation (Phase 15).
 *
 * Detection persists every validated ARB candidate with a deterministic
 * `opportunityKey`, so the same leg set keeps one opportunity episode. After a
 * scan cycle finishes, `reconcileOpportunityEpisodes` tells the store which
 * episodes were seen this cycle; the sweep marks everything else (last seen
 * before this cycle) as disappeared and restores any that came back. That
 * yields disappearance time and the arb's duration window for Phase 15
 * reconstruction and false-positive analysis.
 *
 * The sweep only ever runs on a cycle whose detection completed, so a failed
 * poll (DOWN/DEGRADED) never fabricates disappearances.
 */

import type { DetectionReport, DetectionSummary } from "./detect.js";
import type { ReconcileCounts, WorkerStore } from "./store.js";

export interface ReconcileSummary extends ReconcileCounts {
  /** Episodes still detectable this cycle (the active key set). */
  active: number;
}

/**
 * Reconcile episodes against one completed detection pass at `now`.
 * `active` is the number of distinct episodes the pass touched; `disappeared`
 * / `restored` come from the store's sweep.
 */
export async function reconcileOpportunityEpisodes(
  store: WorkerStore,
  detection: DetectionReport | DetectionSummary,
  options: { now?: number } = {},
): Promise<ReconcileSummary> {
  const now = options.now ?? Date.now();
  const keys =
    "opportunities" in detection && Array.isArray(detection.opportunities)
      ? detection.opportunities
          .map((opportunity) => opportunity.opportunityKey)
          .filter((key): key is string => key !== undefined)
      : [];
  const active = [...new Set(keys)].length;

  const activeKeys = [...new Set(keys)];
  const counts = await store.reconcileOpportunityEpisodes(activeKeys, now);
  return { active, ...counts };
}