/**
 * @22void/arbitrage
 *
 * False-arb detector + stake optimizer (BUILD_AGENT_PROMPT Phases 8–9).
 * Builds the payoff/settlement matrix for every relevant state class, verifies
 * full coverage (no both-loss or uncovered states), then solves:
 *   maximize z s.t. sum(Si)=T, return(state_j) >= z, Si >= 0.
 * An arb exists only when minimum return > T (ARBITRAGE_ENGINE_SPEC §23–25).
 *
 * Status: Phase 0 skeleton. Implemented in Phases 8–9.
 */

import type { RejectionReason } from "@22void/domain";

/** Placeholder for a candidate under evaluation (Phase 8). */
export interface ArbitrageCandidate {
  eventId: string;
  legIds: string[];
  status?: "VALIDATING" | "REJECTED";
}

/** Placeholder for a structured rejection verdict (Phase 8). */
export interface RejectionVerdict {
  reason: RejectionReason;
  evidence: Record<string, unknown>;
}