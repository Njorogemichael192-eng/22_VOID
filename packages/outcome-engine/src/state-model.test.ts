import {
  EventStatus,
  MarketFamily,
  MarketType,
  Participant,
  Period,
  SettlementResult,
} from "@22void/domain";
import type { MatchState, SettleableSelection } from "@22void/settlement";
import { describe, expect, it } from "vitest";

import {
  boundaryMax,
  buildStateModel,
  payoffMatrix,
  settleVector,
  settlementMatrix,
} from "./state-model.js";

const WIN = SettlementResult.FULL_WIN;
const LOSS = SettlementResult.FULL_LOSS;
const HALF_WIN = SettlementResult.HALF_WIN;

function match(
  fullTime: [number, number],
  firstHalf: [number, number] | null = null,
  corners: [number, number] | null = null,
  cards: [number, number] | null = null
): MatchState {
  return {
    status: EventStatus.FINISHED,
    fullTime: { home: fullTime[0], away: fullTime[1] },
    firstHalf: firstHalf === null ? null : { home: firstHalf[0], away: firstHalf[1] },
    secondHalf: null,
    extraTime: null,
    penalties: null,
    corners: corners === null ? null : { home: corners[0], away: corners[1] },
    cards: cards === null ? null : { home: cards[0], away: cards[1] },
  };
}

function matchTotal(
  overUnder: "OVER" | "UNDER",
  line: string,
  period: Period = Period.FULL_MATCH
): SettleableSelection {
  return {
    family: MarketFamily.MATCH_TOTAL,
    marketType: MarketType.STANDARD,
    period,
    line,
    outcome: overUnder,
  };
}

function teamTotal(
  participant: Participant,
  overUnder: "OVER" | "UNDER",
  line: string
): SettleableSelection {
  return {
    family: MarketFamily.TEAM_TOTAL,
    marketType: MarketType.STANDARD,
    period: Period.FULL_MATCH,
    participant,
    line,
    outcome: overUnder,
  };
}

function handicap(overUnder: "HOME" | "AWAY", line: string): SettleableSelection {
  return {
    family: MarketFamily.ASIAN_HANDICAP,
    marketType: MarketType.HANDICAP,
    period: Period.FULL_MATCH,
    line,
    outcome: overUnder,
  };
}

function result(outcome: "HOME" | "DRAW" | "AWAY"): SettleableSelection {
  return {
    family: MarketFamily.MATCH_RESULT,
    marketType: MarketType.ONE_X_TWO,
    period: Period.FULL_MATCH,
    outcome,
  };
}

function btts(outcome: "BTTS_YES" | "BTTS_NO"): SettleableSelection {
  return {
    family: MarketFamily.BTTS,
    marketType: MarketType.BTTS,
    period: Period.FULL_MATCH,
    outcome,
  };
}

function corners(overUnder: "OVER" | "UNDER", line: string): SettleableSelection {
  return {
    family: MarketFamily.CORNERS,
    marketType: MarketType.STANDARD,
    period: Period.FULL_MATCH,
    line,
    outcome: overUnder,
  };
}

function exactScore(outcome: string): SettleableSelection {
  return {
    family: MarketFamily.EXACT_SCORE,
    marketType: MarketType.EXACT_SCORE,
    period: Period.FULL_MATCH,
    outcome,
  };
}

function keys(states: { vector: SettlementResult[] }[]): Set<string> {
  return new Set(states.map((state) => state.vector.join(",")));
}

describe("boundaryMax", () => {
  it("derives boundaries from lines and binary markets", () => {
    expect(boundaryMax([matchTotal("OVER", "3.5")])).toBe(4);
    expect(boundaryMax([handicap("HOME", "-2.25")])).toBe(3);
    expect(boundaryMax([result("HOME")])).toBe(1);
    expect(boundaryMax([exactScore("3-2")])).toBe(3);
    expect(boundaryMax([])).toBe(0);
  });
});

describe("state model — complementary markets", () => {
  it("reduces Over/Under 2.5 to exactly two classes", () => {
    const selections = [matchTotal("OVER", "2.5"), matchTotal("UNDER", "2.5")];
    const { states, selectionIndices, unknown } = buildStateModel(selections);

    expect(unknown).toEqual([]);
    expect(selectionIndices).toEqual([0, 1]);
    expect(keys(states).size).toBe(2);
    for (const state of states) {
      expect(state.vector.filter((entry) => entry === WIN)).toHaveLength(1);
    }

    const overWins = states.find((state) => state.vector[0] === WIN);
    const underWins = states.find((state) => state.vector[1] === WIN);
    expect(matchTotal2(overWins?.representative)).toBeGreaterThanOrEqual(3);
    expect(matchTotal2(underWins?.representative)).toBeLessThanOrEqual(2);
  });

  it("keeps BTTS yes/no complementary", () => {
    const { states } = buildStateModel([btts("BTTS_YES"), btts("BTTS_NO")]);
    expect(keys(states).size).toBe(2);
    for (const state of states) {
      expect(state.vector.filter((entry) => entry === WIN)).toHaveLength(1);
    }
  });

  it("partitions 1X2 into three mutually exclusive classes", () => {
    const { states } = buildStateModel([result("HOME"), result("DRAW"), result("AWAY")]);
    expect(keys(states).size).toBe(3);
    for (const state of states) {
      expect(state.vector.filter((entry) => entry === WIN)).toHaveLength(1);
    }
  });
});

describe("state model — spec §21 coverage matrix", () => {
  const selections = [
    teamTotal(Participant.HOME, "OVER", "1.5"),
    teamTotal(Participant.AWAY, "OVER", "1.5"),
    matchTotal("UNDER", "3.5"),
  ];

  function expectScoreVector(score: [number, number], expected: SettlementResult[]) {
    const { results } = settleVector(selections, match(score));
    expect(results).toEqual(expected);
  }

  it("classifies 2-0, 1-1 and 2-2 as the spec describes", () => {
    expectScoreVector([2, 0], [WIN, LOSS, WIN]);
    expectScoreVector([1, 1], [LOSS, LOSS, WIN]);
    expectScoreVector([2, 2], [WIN, WIN, LOSS]);
  });

  it("includes every one of those classes in the reduced model", () => {
    const { states } = buildStateModel(selections);
    const modelKeys = keys(states);
    expect(modelKeys.has([WIN, LOSS, WIN].join(","))).toBe(true);
    expect(modelKeys.has([LOSS, LOSS, WIN].join(","))).toBe(true);
    expect(modelKeys.has([WIN, WIN, LOSS].join(","))).toBe(true);
  });
});

describe("state model — spec §27 false overlap", () => {
  it("exposes a state where Over 10.5 and Under 13.5 both win", () => {
    const selections = [matchTotal("OVER", "10.5"), matchTotal("UNDER", "13.5")];
    const { states } = buildStateModel(selections);
    expect(keys(states).has([WIN, WIN].join(","))).toBe(true);
  });
});

describe("state model — Asian quarter lines", () => {
  it("settles Home -0.75 through its two components", () => {
    const selection = [handicap("HOME", "-0.75")];
    expect(settleVector(selection, match([1, 0])).results).toEqual([HALF_WIN]);
    expect(settleVector(selection, match([2, 0])).results).toEqual([WIN]);
    expect(settleVector(selection, match([0, 0])).results).toEqual([LOSS]);
  });

  it("produces half-win classes in the model and never a push", () => {
    const { states } = buildStateModel([handicap("HOME", "-0.75")]);
    const results = states.map((state) => state.vector[0]);
    expect(results).toContain(HALF_WIN);
    expect(results).toContain(WIN);
    expect(results).toContain(LOSS);
    expect(results).not.toContain(SettlementResult.PUSH);
  });
});

describe("state model — corners", () => {
  it("models a corner total dimension independently of goals", () => {
    const selections = [corners("OVER", "10.5"), corners("UNDER", "10.5")];
    const { states } = buildStateModel(selections);

    expect(keys(states).size).toBe(2);
    for (const state of states) {
      expect(state.corners).not.toBeNull();
      expect(state.vector.filter((entry) => entry === WIN)).toHaveLength(1);
    }
    const overWins = states.find((state) => state.vector[0] === WIN);
    expect((overWins?.corners?.home ?? 0) + (overWins?.corners?.away ?? 0)).toBeGreaterThanOrEqual(
      11
    );
  });
});

describe("state model — periods", () => {
  const selections = [matchTotal("OVER", "1.5", Period.FIRST_HALF), matchTotal("OVER", "2.5")];

  it("settles first-half and full-match markets from the period state", () => {
    expect(settleVector(selections, match([1, 1], [1, 1])).results).toEqual([WIN, LOSS]);
    expect(settleVector(selections, match([2, 1], [1, 1])).results).toEqual([WIN, WIN]);
    expect(settleVector(selections, match([0, 0], [0, 0])).results).toEqual([LOSS, LOSS]);
  });

  it("only generates consistent states (first half never exceeds full time)", () => {
    const { states } = buildStateModel(selections);
    for (const state of states) {
      expect(state.firstHalf).not.toBeNull();
      expect(state.firstHalf?.homeGoals ?? 0).toBeLessThanOrEqual(state.representative.homeGoals);
      expect(state.firstHalf?.awayGoals ?? 0).toBeLessThanOrEqual(state.representative.awayGoals);
    }
  });
});

describe("state model — exact score", () => {
  it("includes the exact winning scoreline as a class representative", () => {
    const { states } = buildStateModel([exactScore("3-2")]);
    const winner = states.find((state) => state.vector[0] === WIN);
    expect(winner?.representative).toEqual({ homeGoals: 3, awayGoals: 2 });
    expect(keys(states).size).toBe(2);
  });
});

describe("state model — unknown selections (Rule 3)", () => {
  it("reports unsupported periods instead of guessing", () => {
    const extraTime: SettleableSelection = {
      family: MarketFamily.MATCH_TOTAL,
      marketType: MarketType.STANDARD,
      period: Period.EXTRA_TIME,
      line: "1.5",
      outcome: "OVER",
    };
    const { states, selectionIndices, unknown } = buildStateModel([
      extraTime,
      matchTotal("OVER", "2.5"),
    ]);

    expect(unknown).toHaveLength(1);
    expect(unknown[0]?.index).toBe(0);
    expect(unknown[0]?.reason).toContain("NO_STATE_MODEL");
    expect(selectionIndices).toEqual([1]);
    expect(states.length).toBeGreaterThan(0);
    for (const state of states) expect(state.vector).toHaveLength(1);
  });

  it("reports a total market without a line", () => {
    const withoutLine: SettleableSelection = {
      family: MarketFamily.MATCH_TOTAL,
      marketType: MarketType.STANDARD,
      period: Period.FULL_MATCH,
      outcome: "OVER",
    };
    const { unknown, states } = buildStateModel([withoutLine]);
    expect(states).toEqual([]);
    expect(unknown[0]?.reason).toContain("line is required");
  });
});

describe("payoff matrix", () => {
  it("maps settlement results to return multipliers", () => {
    const { states } = buildStateModel([matchTotal("OVER", "2.5"), matchTotal("UNDER", "2.5")]);
    const matrix = payoffMatrix(states, [2.2, 2.1]);
    expect(matrix).toHaveLength(states.length);
    for (const row of matrix) expect(row).toHaveLength(2);
    expect(matrix).toContainEqual([2.2, 0]);
    expect(matrix).toContainEqual([0, 2.1]);
  });

  it("exposes the settlement matrix identical to the state vectors", () => {
    const { states } = buildStateModel([matchTotal("OVER", "2.5"), matchTotal("UNDER", "2.5")]);
    expect(settlementMatrix(states)).toEqual(states.map((state) => state.vector));
  });

  it("rejects mismatched odds length", () => {
    const { states } = buildStateModel([matchTotal("OVER", "2.5")]);
    expect(() => payoffMatrix(states, [2.0, 2.0])).toThrow(/does not match/);
  });
});

function matchTotal2(score: { homeGoals: number; awayGoals: number } | undefined): number {
  if (score === undefined) return Number.NaN;
  return score.homeGoals + score.awayGoals;
}
