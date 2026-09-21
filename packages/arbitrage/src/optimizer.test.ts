import { MarketFamily, MarketType, Period, SettlementResult } from "@22void/domain";
import type { Participant } from "@22void/domain";
import type { OutcomeState } from "@22void/outcome-engine";
import type { SettleableSelection } from "@22void/settlement";
import { describe, expect, it } from "vitest";

import { detectFalseArb } from "./coverage.js";
import type { ArbitrageLeg } from "./coverage.js";
import {
  buildMultiplierMatrix,
  classicThreeWayStakes,
  classicTwoWayStakes,
  optimizeCandidate,
  optimizeStakes,
  reciprocalSum,
} from "./optimizer.js";

let legCounter = 0;

function selection(
  family: MarketFamily,
  marketType: MarketType,
  outcome: string,
  extra: { line?: string; participant?: Participant; period?: Period } = {}
): SettleableSelection {
  return {
    family,
    marketType,
    outcome,
    period: extra.period ?? Period.FULL_MATCH,
    ...(extra.line !== undefined ? { line: extra.line } : {}),
    ...(extra.participant !== undefined ? { participant: extra.participant } : {}),
  };
}

function leg(sel: SettleableSelection, odds: number): ArbitrageLeg {
  legCounter += 1;
  return { id: `leg-${legCounter}`, selection: sel, odds };
}

function matchTotal(overUnder: "OVER" | "UNDER", line: string, odds: number): ArbitrageLeg {
  return leg(selection(MarketFamily.MATCH_TOTAL, MarketType.STANDARD, overUnder, { line }), odds);
}

function btts(outcome: "BTTS_YES" | "BTTS_NO", odds: number): ArbitrageLeg {
  return leg(selection(MarketFamily.BTTS, MarketType.BTTS, outcome), odds);
}

function handicap(outcome: "HOME" | "AWAY", line: string, odds: number): ArbitrageLeg {
  return leg(selection(MarketFamily.ASIAN_HANDICAP, MarketType.HANDICAP, outcome, { line }), odds);
}

describe("optimizeStakes — classic two-way", () => {
  it("matches the closed form and guarantees a profit", () => {
    const report = detectFalseArb([
      matchTotal("OVER", "2.5", 2.2),
      matchTotal("UNDER", "2.5", 2.1),
    ]);
    const plan = optimizeCandidate(report, 100);

    expect(plan.status).toBe("ARB");
    expect(plan.isArb).toBe(true);
    const expected = classicTwoWayStakes([2.2, 2.1], 100);
    expect(plan.stakes[0]).toBeCloseTo(expected[0]!, 6);
    expect(plan.stakes[1]).toBeCloseTo(expected[1]!, 6);
    expect(plan.minReturn).toBeCloseTo(100 / reciprocalSum([2.2, 2.1]), 6);
    expect(plan.guaranteedProfit).toBeCloseTo(plan.minReturn - 100, 6);
    expect(plan.roi).toBeCloseTo(plan.guaranteedProfit / 100, 9);
  });

  it("declares NO_ARB when the best minimum return does not beat the stake", () => {
    const report = detectFalseArb([
      matchTotal("OVER", "2.5", 1.9),
      matchTotal("UNDER", "2.5", 1.95),
    ]);
    const plan = optimizeCandidate(report, 100);

    expect(plan.status).toBe("NO_ARB");
    expect(plan.isArb).toBe(false);
    expect(plan.guaranteedProfit).toBeLessThan(0);
  });
});

describe("optimizeStakes — three-way", () => {
  it("matches the classic 1X2 closed form", () => {
    const legs = [
      leg(selection(MarketFamily.MATCH_RESULT, MarketType.ONE_X_TWO, "HOME"), 3.5),
      leg(selection(MarketFamily.MATCH_RESULT, MarketType.ONE_X_TWO, "DRAW"), 3.4),
      leg(selection(MarketFamily.MATCH_RESULT, MarketType.ONE_X_TWO, "AWAY"), 3.6),
    ];
    const report = detectFalseArb(legs);
    expect(report.status).toBe("COVERED");

    const plan = optimizeCandidate(report, 300);
    const expected = classicThreeWayStakes([3.5, 3.4, 3.6], 300);
    expect(plan.status).toBe("ARB");
    plan.stakes.forEach((stake, index) => expect(stake).toBeCloseTo(expected[index]!, 6));
    expect(plan.stakes.reduce((sum, stake) => sum + stake, 0)).toBeCloseTo(300, 6);
  });
});

describe("optimizeStakes — push-aware", () => {
  function state(id: string, vector: SettlementResult[]): OutcomeState {
    return {
      id,
      representative: { homeGoals: 0, awayGoals: 0 },
      firstHalf: null,
      corners: null,
      cards: null,
      vector,
    };
  }

  it("treats a push as a returned stake, not a loss", () => {
    const legs = [matchTotal("OVER", "2.0", 2.0), matchTotal("UNDER", "2.0", 2.0)];
    const states = [
      state("push-left", [SettlementResult.PUSH, SettlementResult.FULL_WIN]),
      state("push-right", [SettlementResult.FULL_WIN, SettlementResult.PUSH]),
    ];

    const plan = optimizeStakes(states, legs, 100);
    // Push counts as a multiplier of 1: 0.5*1 + 0.5*2 = 1.5, not 0.5*0 + 0.5*2 = 1.0.
    expect(plan.minReturn).toBeCloseTo(150, 6);
    expect(plan.status).toBe("ARB");
    expect(buildMultiplierMatrix(states, legs)).toEqual([
      [1, 2],
      [2, 1],
    ]);
  });
});

describe("optimizeStakes — half settlement", () => {
  it("uses exact half-win/half-loss multipliers on an Asian quarter pair", () => {
    const report = detectFalseArb([handicap("HOME", "-0.75", 2.1), handicap("AWAY", "0.75", 2.1)]);
    expect(report.status).toBe("COVERED");

    const plan = optimizeCandidate(report, 100);
    expect(plan.status).toBe("ARB");
    expect(plan.minReturn).toBeCloseTo(103.333333, 5);
    // (2.1+1)/2 = 1.55 and 0.5 are present in the matrix — never collapsed to WIN/LOSS.
    expect(plan.multiplierMatrix.flat().some((value) => Math.abs(value - 1.55) < 1e-9)).toBe(true);
    expect(plan.multiplierMatrix.flat().some((value) => Math.abs(value - 0.5) < 1e-9)).toBe(true);
  });
});

describe("optimizeStakes — multi-leg", () => {
  it("solves a four-leg goals + BTTS structure", () => {
    const legs = [
      matchTotal("OVER", "2.5", 2.2),
      matchTotal("UNDER", "2.5", 2.1),
      btts("BTTS_YES", 2.1),
      btts("BTTS_NO", 2.1),
    ];
    const report = detectFalseArb(legs);
    expect(report.status).toBe("COVERED");

    const plan = optimizeCandidate(report, 200);
    expect(plan.status).toBe("ARB");
    expect(plan.stakes).toHaveLength(4);
    for (const stake of plan.stakes) expect(stake).toBeGreaterThanOrEqual(0);
    expect(plan.stakes.reduce((sum, stake) => sum + stake, 0)).toBeCloseTo(200, 6);
    expect(plan.minReturn).toBeCloseTo(Math.min(...plan.stateReturns), 9);
    expect(plan.minReturn).toBeGreaterThan(200);
  });
});

describe("optimizeStakes — invariants and guards", () => {
  it("keeps stake sum, non-negativity and the minimum-return identity", () => {
    const report = detectFalseArb([
      matchTotal("OVER", "2.5", 2.2),
      matchTotal("UNDER", "2.5", 2.1),
    ]);
    const plan = optimizeCandidate(report, 137.5);
    expect(plan.stakes.reduce((sum, stake) => sum + stake, 0)).toBeCloseTo(137.5, 6);
    for (const stake of plan.stakes) expect(stake).toBeGreaterThanOrEqual(0);
    expect(plan.minReturn).toBeCloseTo(Math.min(...plan.stateReturns), 9);
    expect(plan.guaranteedProfit).toBeCloseTo(plan.minReturn - 137.5, 9);
  });

  it("rejects optimization of a REJECTED candidate", () => {
    const report = detectFalseArb([
      matchTotal("OVER", "10.5", 2.0),
      matchTotal("UNDER", "13.5", 2.0),
    ]);
    expect(report.status).toBe("REJECTED");
    expect(() => optimizeCandidate(report, 100)).toThrow(/OPTIMIZATION_FAILED/);
  });

  it("validates the total stake and alignment", () => {
    const report = detectFalseArb([
      matchTotal("OVER", "2.5", 2.2),
      matchTotal("UNDER", "2.5", 2.1),
    ]);
    expect(() => optimizeCandidate(report, 0)).toThrow(/totalStake/);
    expect(() => optimizeStakes([], report.legs, 100)).toThrow(/at least one leg/);
  });

  it("exposes the reciprocal sum as a heuristic only", () => {
    expect(reciprocalSum([2.0, 2.0])).toBeCloseTo(1, 12);
    expect(reciprocalSum([2.2, 2.1])).toBeLessThan(1);
  });
});
