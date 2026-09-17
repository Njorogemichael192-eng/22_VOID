/**
 * @22void/settlement
 *
 * Settlement engine (BUILD_AGENT_PROMPT Phase 6).
 * Maps states to SettlementResult and computes payout multipliers:
 *   FULL_WIN -> odds, PUSH -> 1, HALF_WIN -> (odds+1)/2,
 *   HALF_LOSS -> 0.5, FULL_LOSS -> 0, VOID -> 1.
 * Asian quarter lines are split into two component lines per ARBITRAGE_ENGINE_SPEC §13–15.
 *
 * Status: Phase 0 skeleton. Implemented in Phase 6.
 */

import type { SettlementResult } from "@22void/domain";

/** Placeholder for the actionable settlement rule (Phase 6). */
export interface SettlementRule {
  ruleVersion: string;
  /** Minimum leg multiplier accounting for half-win/push semantics. */
  evaluate(stake: number, odds: number, result: SettlementResult): number;
}