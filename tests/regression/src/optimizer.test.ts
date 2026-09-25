import type { MarketType } from "@22void/domain";
import type { ArbitrageLeg } from "@22void/arbitrage";
import {
  buildMultiplierMatrix,
  classicThreeWayStakes,
  classicTwoWayStakes,
  optimizeStakes,
  reciprocalSum,
} from "@22void/arbitrage";
import { buildStateModel } from "@22void/outcome-engine";
import type { SettleableSelection } from "@22void/settlement";
import { describe, expect, it } from "vitest";

import { regressionCases, type RegressionLeg } from "../../../tests/fixtures/regression/index.js";
import { toArbitrageLeg } from "./helpers.js";

function toSelection(leg: RegressionLeg): SettleableSelection {
  return {
    family: leg.family,
    marketType: leg.marketType as MarketType,
    period: leg.period,
    ...(leg.participant !== undefined ? { participant: leg.participant } : {}),
    ...(leg.line !== undefined ? { line: leg.line } : {}),
    outcome: leg.outcome,
  };
}

function arbCaseIds(): string[] {
  return regressionCases
    .filter((entry) => entry.expected.scan === "ARB")
    .map((entry) => entry.id);
}

describe("Phase 17 optimizer regression", () => {
  it.each(arbCaseIds())("%s produces a guaranteed positive return on the reduced model", (caseId) => {
    const entry = regressionCases.find((candidate) => candidate.id === caseId)!;
    const selections = entry.legs.map(toSelection);
    const legs = entry.legs.map(toArbitrageLeg);
    const model = buildStateModel(selections);
    expect(model.unknown).toHaveLength(0);
    expect(model.states.length).toBeGreaterThan(0);

    const plan = optimizeStakes(model.states, legs, 100);
    expect(plan.isArb, caseId).toBe(true);
    expect(plan.status).toBe("ARB");
    expect(plan.guaranteedProfit, caseId).toBeGreaterThan(0);
    expect(plan.stakes.reduce((sum, stake) => sum + stake, 0)).toBeCloseTo(100, 6);
    // A leg can legitimately take a zero stake when another leg on a different
    // metric already covers its winning states (e.g. DC overlaps 1X on a home
    // win), but at least one leg must actually be backed.
    expect(plan.stakes.some((stake) => stake > 0), caseId).toBe(true);
    for (const stake of plan.stakes) {
      expect(stake).toBeGreaterThanOrEqual(0);
    }
    for (const stateReturn of plan.stateReturns) {
      expect(stateReturn).toBeGreaterThan(100);
      expect(stateReturn).toBeCloseTo(plan.minReturn, 6);
    }
  });

  it("the Classic two-way formula (§45) matches the LP on a standard complement", () => {
    const entry = regressionCases.find(
      (candidate) => candidate.id === "CASE_01_STANDARD_COMPLEMENT"
    )!;
    const odds = entry.legs.map((leg) => leg.odds) as [number, number];
    const classic = classicTwoWayStakes(odds, 100);
    expect(classic[0]! + classic[1]!).toBeCloseTo(100, 9);
    const r = reciprocalSum(odds);
    expect(r).toBeLessThan(1);
    const expectedProfit = Math.round((100 / r - 100) * 1e4) / 1e4;

    const plan = optimizeStakes(
      buildStateModel(entry.legs.map(toSelection)).states,
      entry.legs.map(toArbitrageLeg),
      100
    );
    expect(plan.guaranteedProfit).toBeCloseTo(expectedProfit, 2);
    for (let index = 0; index < plan.stakes.length; index += 1) {
      expect(plan.stakes[index]!).toBeCloseTo(classic[index]!, 4);
    }
  });

  it("the Classic three-way formula (§46) matches the LP on a 1X2 partition", () => {
    const entry = regressionCases.find((candidate) => candidate.id === "CASE_02_1X2_THREE_WAY")!;
    const odds = entry.legs.map((leg) => leg.odds);
    const classic = classicThreeWayStakes(odds, 100);
    expect(classic.reduce((sum, value) => sum + value, 0)).toBeCloseTo(100, 9);

    const plan = optimizeStakes(
      buildStateModel(entry.legs.map(toSelection)).states,
      entry.legs.map(toArbitrageLeg),
      100
    );
    for (let index = 0; index < plan.stakes.length; index += 1) {
      expect(plan.stakes[index]!).toBeCloseTo(classic[index]!, 4);
    }
  });

  it("buildMultiplierMatrix is exactly the state-payoff A matrix from the spec (§22)", () => {
    const entry = regressionCases.find(
      (candidate) => candidate.id === "CASE_01_STANDARD_COMPLEMENT"
    )!;
    const selections = entry.legs.map(toSelection);
    const legs = entry.legs.map(toArbitrageLeg);
    const model = buildStateModel(selections);
    const matrix = buildMultiplierMatrix(model.states, legs);
    expect(matrix).toHaveLength(model.states.length);
    for (const [stateIndex, row] of matrix.entries()) {
      expect(row).toHaveLength(legs.length);
      const vector = model.states[stateIndex]!.vector;
      for (let legIndex = 0; legIndex < row.length; legIndex += 1) {
        const multiplier = row[legIndex]!;
        const result = vector[legIndex];
        expect(multiplier).toBeGreaterThanOrEqual(0);
        if (result === "FULL_WIN") expect(multiplier).toBe(legs[legIndex]!.odds);
        if (result === "FULL_LOSS") expect(multiplier).toBe(0);
        if (result === "PUSH") expect(multiplier).toBe(1);
      }
    }
  });

  it("optimizeStakes rejects an empty or misaligned model predictably", () => {
    const entry = regressionCases.find(
      (candidate) => candidate.id === "CASE_01_STANDARD_COMPLEMENT"
    )!;
    const legs = entry.legs.map(toArbitrageLeg) as ArbitrageLeg[];
    expect(() => optimizeStakes([], legs, 100)).toThrow(/at least one leg and one state/);
    expect(() => optimizeStakes([], [], 100)).toThrow(/at least one leg and one state/);
    expect(() => optimizeStakes([], legs, 0)).toThrow(/totalStake must be a positive number/);
  });
});