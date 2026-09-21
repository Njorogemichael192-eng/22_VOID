/**
 * @22void/settlement
 *
 * Settlement engine (BUILD_AGENT_PROMPT Phase 6, spec §9–§16, §53).
 *
 * Evaluates a canonical selection against a final match state into a
 * SettlementResult with component-level detail: standard and Asian totals
 * (whole/half/quarter lines), Asian handicaps, 1X2, double chance, BTTS and
 * exact score, across periods (full / first half / second half / extra time /
 * penalties). Quarter lines decompose into two 50/50 component lines and the
 * result is always derived from component settlements — never special-cased.
 * Rules are versioned per provider with effective windows; unknown settlement
 * always surfaces as a reason, never a guess (Rule 3, UNKNOWN_SETTLEMENT).
 */

export { formatLine, lineKind, parseCanonicalLine, splitAsianLine } from "./line";
export type { LineKind } from "./line";

export { periodScore, settleSelection } from "./settle";
export type {
  LineScore,
  MatchState,
  SettleableSelection,
  SettleAssessment,
  SettleCoreResult,
} from "./settle";

export { SettlementEngine, SettlementRuleStore, standardSettlementRule } from "./engine";
export type { SettlementRule, SettleVerdict, SettlementEngineOptions } from "./engine";

export { componentPayouts, payout } from "./payout";
