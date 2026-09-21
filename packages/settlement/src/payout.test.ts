import { describe, expect, it } from "vitest";

import { EventStatus, MarketFamily, MarketType, Period, SettlementResult } from "@22void/domain";

import { componentPayouts, payout } from "./payout";
import { settleSelection } from "./settle";
import type { MatchState, SettleableSelection } from "./settle";

function finishedMatch(home: number, away: number): MatchState {
  return {
    status: EventStatus.FINISHED,
    fullTime: { home, away },
    firstHalf: null,
    secondHalf: null,
    extraTime: null,
    penalties: null,
    corners: null,
    cards: null,
  };
}

function settle(
  family: MarketFamily,
  marketType: MarketType,
  line: string,
  outcome: string,
  score: [number, number]
): ReturnType<typeof settleSelection> {
  const selection: SettleableSelection = {
    family,
    marketType,
    period: Period.FULL_MATCH,
    line,
    outcome,
  };
  return settleSelection(selection, finishedMatch(score[0], score[1]));
}

function settledState(result: ReturnType<typeof settleSelection>): {
  result: SettlementResult;
  components?: string[];
} {
  if (result.kind !== "settled") throw new Error("expected settled");
  return result.assessment.state as unknown as { result: SettlementResult; components?: string[] };
}

describe("payout formulas (§10)", () => {
  it("full win returns stake × odds", () => {
    expect(payout(100, 2.1, SettlementResult.FULL_WIN)).toBe(210);
  });

  it("full loss returns zero", () => {
    expect(payout(100, 2.1, SettlementResult.FULL_LOSS)).toBe(0);
  });

  it("push returns the stake", () => {
    expect(payout(100, 2.1, SettlementResult.PUSH)).toBe(100);
  });

  it("half win returns stake × (odds + 1) / 2", () => {
    expect(payout(100, 2.1, SettlementResult.HALF_WIN)).toBe(155);
  });

  it("half loss returns half the stake", () => {
    expect(payout(100, 2.1, SettlementResult.HALF_LOSS)).toBe(50);
  });

  it("void returns the stake", () => {
    expect(payout(100, 2.1, SettlementResult.VOID)).toBe(100);
  });
});

describe("component payout breakdown (§13)", () => {
  it("a quarter [PUSH, LOSS] pays half the stake and matches HALF_LOSS", () => {
    const result = settle(MarketFamily.ASIAN_TOTAL, MarketType.ASIAN, "2.25", "OVER", [2, 0]);
    const state = settledState(result);
    expect(state.result).toBe(SettlementResult.HALF_LOSS);
    if (result.kind === "settled") {
      const perComponent = componentPayouts(result.assessment, 100, 2.0);
      expect(perComponent).toEqual([50, 0]);
      expect(perComponent.reduce((sum, value) => sum + value, 0)).toBe(
        payout(100, 2.0, SettlementResult.HALF_LOSS)
      );
    }
  });

  it("a quarter [WIN, PUSH] pays stake × (odds + 1) / 2 and matches HALF_WIN", () => {
    const result = settle(MarketFamily.ASIAN_TOTAL, MarketType.ASIAN, "2.75", "OVER", [3, 0]);
    if (result.kind !== "settled") throw new Error("expected settled");
    const perComponent = componentPayouts(result.assessment, 100, 2.5);
    expect(perComponent).toEqual([125, 50]); // 50@2.5 WIN + 50 PUSH
    expect(perComponent.reduce((sum, value) => sum + value, 0)).toBe(
      payout(100, 2.5, SettlementResult.HALF_WIN)
    );
  });

  it("component payouts sum to the gross return for every §69-spec case", () => {
    const cases: Array<[string, "OVER" | "UNDER", [number, number]]> = [
      ["2.5", "OVER", [3, 0]],
      ["2.5", "OVER", [1, 1]],
      ["2.0", "OVER", [2, 0]],
      ["2.0", "UNDER", [2, 0]],
      ["2.25", "OVER", [3, 0]],
      ["2.25", "OVER", [2, 0]],
      ["2.25", "UNDER", [2, 0]],
      ["2.75", "OVER", [3, 0]],
      ["2.75", "OVER", [2, 0]],
    ];
    for (const [line, outcome, score] of cases) {
      const result = settle(MarketFamily.ASIAN_TOTAL, MarketType.ASIAN, line, outcome, score);
      if (result.kind !== "settled")
        throw new Error(`expected settled for ${line} ${outcome} ${score}`);
      const state = settledState(result);
      const perComponent = componentPayouts(result.assessment, 100, 2.0);
      const total = perComponent.reduce((sum, value) => sum + value, 0);
      expect(total, `${line} ${outcome} @ ${score}`).toBe(payout(100, 2.0, state.result));
    }
  });
});
