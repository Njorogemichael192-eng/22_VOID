import { z } from "zod";

import {
  ComponentResult,
  componentResultSchema,
  SettlementResult,
  settlementResultSchema,
} from "./value-sets";

/**
 * Map a quarter-line component split to a canonical settlement result (§9).
 * A wager is split 50/50 across two components; each component is fully WIN,
 * fully LOSS, PUSH or VOID.
 */
export function settlementResultFromComponents(
  components: readonly ComponentResult[]
): SettlementResult {
  if (components.length === 0) {
    throw new Error("settlement requires at least one component");
  }
  if (components.includes(ComponentResult.VOID)) {
    if (components.every((component) => component === ComponentResult.VOID)) {
      return SettlementResult.VOID;
    }
    throw new Error("components cannot mix VOID with WIN/LOSS/PUSH results");
  }
  const hasWin = components.includes(ComponentResult.WIN);
  const hasLoss = components.includes(ComponentResult.LOSS);
  if (hasWin && hasLoss) {
    throw new Error("components mixing WIN and LOSS have no canonical settlement result");
  }
  if (hasWin)
    return components.every((component) => component === ComponentResult.WIN)
      ? SettlementResult.FULL_WIN
      : SettlementResult.HALF_WIN;
  if (hasLoss)
    return components.every((component) => component === ComponentResult.LOSS)
      ? SettlementResult.FULL_LOSS
      : SettlementResult.HALF_LOSS;
  return SettlementResult.PUSH;
}

export function isSettlementComponentSplit(state: SettlementState): boolean {
  return state.components !== undefined;
}

export const settlementStateSchema = z
  .object({
    result: settlementResultSchema,
    components: z.array(componentResultSchema).optional(),
  })
  .superRefine((state, ctx) => {
    if (state.components === undefined) return;
    let derived: SettlementResult;
    try {
      derived = settlementResultFromComponents(state.components);
    } catch {
      ctx.addIssue({
        code: "custom",
        path: ["components"],
        message: "components do not form a canonical settlement result",
      });
      return;
    }
    if (derived !== state.result) {
      ctx.addIssue({
        code: "custom",
        path: ["result"],
        message: `components resolve to "${derived}", not "${state.result}"`,
      });
    }
  });
export type SettlementState = z.infer<typeof settlementStateSchema>;

/**
 * Stake multiplier implied by a result vs the decimal odds (§10).
 * return = stake * returnMultiplier.
 */
export function returnMultiplier(result: SettlementResult, odds: number): number {
  switch (result) {
    case SettlementResult.FULL_WIN:
      return odds;
    case SettlementResult.FULL_LOSS:
      return 0;
    case SettlementResult.HALF_WIN:
      return (odds + 1) / 2;
    case SettlementResult.HALF_LOSS:
      return 0.5;
    case SettlementResult.PUSH:
      return 1;
    case SettlementResult.VOID:
      return 1;
  }
}
