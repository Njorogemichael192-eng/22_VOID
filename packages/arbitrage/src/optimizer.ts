/**
 * Stake optimizer (BUILD_AGENT_PROMPT Phase 9, spec §23–§25, §45–§52).
 *
 * Solves the maximin problem: distribute a fixed total stake so the minimum
 * portfolio return across all reduced states is as large as possible.
 *
 * ```text
 * maximize z
 * subject to sum(Si) = T
 *            portfolioReturn(state_j) >= z   for every state
 *            Si >= 0
 * ```
 *
 * The payoff matrix uses the exact return multipliers from the settlement
 * engine (§10, §51): push/void return 1, half loss 0.5, half win (O+1)/2. A
 * state is only covered when the solver can actually guarantee a return, so
 * the authoritative metric is `minimum return`, not a reciprocal-sum shortcut
 * (§23, §45). The reported `minReturn` is recomputed from the final stakes, so
 * a numerically-off LP solution can never overstate the guarantee.
 */

import { returnMultiplier } from "@22void/domain";
import type { OutcomeState } from "@22void/outcome-engine";

import type { ArbitrageLeg, CoverageReport } from "./coverage";
import { simplexMinimize } from "./simplex";

const EPS = 1e-9;

export interface StakePlan {
  status: "ARB" | "NO_ARB";
  /** Stake per leg, aligned with the input legs; sums to `totalStake`. */
  stakes: number[];
  totalStake: number;
  /** Portfolio return `sum(A[j][i] * stake_i)` for every state. */
  stateReturns: number[];
  /** Smallest entry of `stateReturns` — the guaranteed return. */
  minReturn: number;
  /** `minReturn - totalStake`. */
  guaranteedProfit: number;
  /** `guaranteedProfit / totalStake`. */
  roi: number;
  isArb: boolean;
  /** `A[state][leg]` return multipliers the plan was solved against. */
  multiplierMatrix: number[][];
}

/** `sum(1/odds)` — a heuristic only; never the arb decision (§23, §27). */
export function reciprocalSum(odds: readonly number[]): number {
  return odds.reduce((sum, odd) => sum + 1 / odd, 0);
}

/** Builds `A[state][leg]` return multipliers from the reduced state model. */
export function buildMultiplierMatrix(
  states: readonly OutcomeState[],
  legs: readonly ArbitrageLeg[]
): number[][] {
  return states.map((state) =>
    state.vector.map((result, index) => returnMultiplier(result, legs[index]?.odds ?? Number.NaN))
  );
}

function solveMaximin(matrix: readonly (readonly number[])[]): number[] {
  const legCount = matrix[0]?.length ?? 0;
  const stateCount = matrix.length;
  const constraintCount = stateCount + 2;
  const variableCount = legCount + 2 + constraintCount;

  const objective = new Array<number>(variableCount).fill(0);
  objective[legCount] = -1;
  objective[legCount + 1] = 1;

  const A: number[][] = [];
  const b: number[] = [];

  matrix.forEach((row, stateIndex) => {
    const line = new Array<number>(variableCount).fill(0);
    for (let leg = 0; leg < legCount; leg += 1) line[leg] = -(row[leg] ?? 0);
    line[legCount] = 1;
    line[legCount + 1] = -1;
    line[legCount + 2 + stateIndex] = 1;
    A.push(line);
    b.push(0);
  });

  const sumRow = new Array<number>(variableCount).fill(0);
  for (let leg = 0; leg < legCount; leg += 1) sumRow[leg] = 1;
  sumRow[legCount + 2 + stateCount] = 1;
  A.push(sumRow);
  b.push(1);

  const negatedSumRow = new Array<number>(variableCount).fill(0);
  for (let leg = 0; leg < legCount; leg += 1) negatedSumRow[leg] = -1;
  negatedSumRow[legCount + 2 + stateCount + 1] = 1;
  A.push(negatedSumRow);
  b.push(-1);

  const result = simplexMinimize(objective, A, b);
  if (result.status !== "optimal") {
    throw new Error(`OPTIMIZATION_FAILED: solver returned ${result.status}`);
  }

  const stakes = new Array<number>(legCount).fill(0);
  for (let leg = 0; leg < legCount; leg += 1) {
    stakes[leg] = Math.max(0, result.solution[leg] ?? 0);
  }
  return stakes;
}

/**
 * Solves the maximin stake plan for a covered candidate. `states` and `legs`
 * must be aligned (each state vector has one settlement per leg).
 */
export function optimizeStakes(
  states: readonly OutcomeState[],
  legs: readonly ArbitrageLeg[],
  totalStake: number
): StakePlan {
  if (!Number.isFinite(totalStake) || totalStake <= 0) {
    throw new Error("OPTIMIZATION_FAILED: totalStake must be a positive number");
  }
  if (legs.length === 0 || states.length === 0) {
    throw new Error("OPTIMIZATION_FAILED: candidate needs at least one leg and one state");
  }
  for (const state of states) {
    if (state.vector.length !== legs.length) {
      throw new Error(
        `OPTIMIZATION_FAILED: state ${state.id} has ${state.vector.length} settlements for ${legs.length} legs`
      );
    }
  }

  const multiplierMatrix = buildMultiplierMatrix(states, legs);
  const fractions = solveMaximin(multiplierMatrix);
  const fractionSum = fractions.reduce((sum, value) => sum + value, 0);
  const normalized = fractionSum > EPS ? fractions.map((value) => value / fractionSum) : fractions;

  const stakes = normalized.map((fraction) => fraction * totalStake);
  const stateReturns = multiplierMatrix.map((row) =>
    row.reduce((sum, multiplier, leg) => sum + multiplier * stakes[leg]!, 0)
  );
  const minReturn = Math.min(...stateReturns);
  const guaranteedProfit = minReturn - totalStake;
  const isArb = minReturn > totalStake + EPS;

  return {
    status: isArb ? "ARB" : "NO_ARB",
    stakes,
    totalStake,
    stateReturns,
    minReturn,
    guaranteedProfit,
    roi: guaranteedProfit / totalStake,
    isArb,
    multiplierMatrix,
  };
}

/**
 * Optimizes a Phase 8 coverage report. Only structurally `COVERED` candidates
 * can be optimized; a rejected candidate has no trustworthy state matrix.
 */
export function optimizeCandidate(report: CoverageReport, totalStake: number): StakePlan {
  if (report.status !== "COVERED") {
    const reasons = report.rejections.map((verdict) => verdict.reason).join(", ");
    throw new Error(`OPTIMIZATION_FAILED: candidate is ${report.status} (${reasons})`);
  }
  return optimizeStakes(report.states, report.legs, totalStake);
}

/** Classic two-way proportional stakes (`Si = T * qi / Q`, spec §45). */
export function classicTwoWayStakes(
  odds: readonly [number, number],
  totalStake: number
): [number, number] {
  const q1 = 1 / odds[0];
  const q2 = 1 / odds[1];
  const q = q1 + q2;
  return [(totalStake * q1) / q, (totalStake * q2) / q];
}

/** Classic three-way proportional stakes (`Si = T * qi / Q`, spec §46). */
export function classicThreeWayStakes(odds: readonly number[], totalStake: number): number[] {
  const q = odds.map((odd) => 1 / odd);
  const total = q.reduce((sum, value) => sum + value, 0);
  return q.map((value) => (totalStake * value) / total);
}
