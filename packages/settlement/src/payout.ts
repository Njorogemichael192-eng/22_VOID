/**
 * Payout formulas (§10) and per-component return breakdown for audit.
 *
 * return = stake × returnMultiplier; the multiplier formula per result:
 *   FULL_WIN → odds, FULL_LOSS → 0, PUSH → 1, HALF_WIN → (odds+1)/2,
 *   HALF_LOSS → 0.5, VOID → 1.
 * Component payouts sum to the total return; a quarter-line [PUSH, LOSS] →
 * stake/2 (HALF_LOSS), [WIN, PUSH] → stake(odds+1)/2 (HALF_WIN).
 */

import { ComponentResult, returnMultiplier, SettlementResult } from "@22void/domain";

import type { SettleAssessment } from "./settle";

/** Return on stake for a canonical result at decimal odds. */
export function payout(stake: number, odds: number, result: SettlementResult): number {
  return stake * returnMultiplier(result, odds);
}

function componentReturn(component: ComponentResult, stake: number, odds: number): number {
  switch (component) {
    case ComponentResult.WIN:
      return stake * odds;
    case ComponentResult.PUSH:
    case ComponentResult.VOID:
      return stake;
    case ComponentResult.LOSS:
      return 0;
  }
}

/**
 * Detailed per-component return. Each component carries an equal share of the
 * stake (a quarter line splits 50/50). Sums exactly to `payout(...)`.
 */
export function componentPayouts(
  assessment: SettleAssessment,
  stake: number,
  odds: number
): number[] {
  const components = assessment.state.components ?? [resultToComponent(assessment.state.result)];
  const share = stake / components.length;
  return components.map((component) => componentReturn(component, share, odds));
}

function resultToComponent(result: SettlementResult): ComponentResult {
  switch (result) {
    case SettlementResult.FULL_WIN:
    case SettlementResult.HALF_WIN:
      return ComponentResult.WIN;
    case SettlementResult.FULL_LOSS:
    case SettlementResult.HALF_LOSS:
      return ComponentResult.LOSS;
    case SettlementResult.PUSH:
      return ComponentResult.PUSH;
    case SettlementResult.VOID:
      return ComponentResult.VOID;
  }
}
