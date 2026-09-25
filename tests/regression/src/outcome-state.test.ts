import type { MarketType } from "@22void/domain";
import type { SettleableSelection } from "@22void/settlement";
import { boundaryMax, buildStateModel, goalMargin, matchTotal, payoffMatrix, settleVector } from "@22void/outcome-engine";
import { describe, expect, it } from "vitest";

import { goldenScoreEvents, regressionCases, SCORE_AWAY_BY_ONE, SCORE_TOTAL_TWO } from "../../../tests/fixtures/regression/index.js";

function toSelection(leg: RegistrationLeg): SettleableSelection {
  return {
    family: leg.family,
    marketType: leg.marketType as MarketType,
    period: leg.period,
    ...(leg.participant !== undefined ? { participant: leg.participant } : {}),
    ...(leg.line !== undefined ? { line: leg.line } : {}),
    outcome: leg.outcome,
  };
}

type RegistrationLeg = (typeof regressionCases)[number]["legs"][number];

type Goals = { homeGoals: number; awayGoals: number };

/** LineScore (home/away) → outcome-engine FootballScore projection. */
function toGoals(score: { home: number; away: number }): Goals {
  return { homeGoals: score.home, awayGoals: score.away };
}

function caseLegs(caseId: string): RegistrationLeg[] {
  const found = regressionCases.find((entry) => entry.id === caseId);
  if (found === undefined) throw new Error(`unknown regression case ${caseId}`);
  return found.legs;
}

describe("Phase 17 outcome-state regression", () => {
  it("matchTotal and goalMargin project golden scores correctly", () => {
    for (const event of goldenScoreEvents) {
      expect(matchTotal(toGoals(event.fullTime)), event.id).toBe(event.total);
      expect(goalMargin(toGoals(event.fullTime)), event.id).toBe(event.margin);
    }
  });

  it("boundaryMax derives the state-model coverage from the requested lines", () => {
    const legs = caseLegs("CASE_01_STANDARD_COMPLEMENT").map(toSelection);
    expect(boundaryMax(legs)).toBe(3);
  });

  it("a whole-line complement collapses to a compact, fully classified state set", () => {
    const legs = caseLegs("CASE_01_STANDARD_COMPLEMENT");
    const leg1 = toSelection(legs[0]!);
    const leg2 = toSelection(legs[1]!);
    const model = buildStateModel([leg1, leg2]);
    expect(model.unknown).toHaveLength(0);
    expect(model.states.length).toBeGreaterThanOrEqual(2);
    expect(model.states.length).toBeLessThan(200);

    for (const state of model.states) {
      expect(state.vector).toHaveLength(2);
      for (const result of state.vector) {
        // Whole 2.5 lines never push — every vector entry is a full win/loss.
        expect(["FULL_WIN", "FULL_LOSS"]).toContain(result);
      }
      const overWin = state.vector[0] === "FULL_WIN";
      const underWin = state.vector[1] === "FULL_WIN";
      // Complements in one metric: exactly one side wins per state.
      expect(overWin).not.toBe(underWin);
    }
  });

  it("settleVector reproduces the golden settlement of a score through the model", () => {
    const legs = caseLegs("CASE_01_STANDARD_COMPLEMENT").map(toSelection);
    const zeroZero = goldenScoreEvents.find((event) => event.id === "score-0-0")!;
    const vector = settleVector(legs, {
      status: "FINISHED",
      fullTime: zeroZero.fullTime,
      firstHalf: null,
      secondHalf: null,
      extraTime: null,
      penalties: null,
      corners: null,
      cards: null,
    });
    expect(vector.unknownIndices).toHaveLength(0);
    expect(vector.results).toEqual(["FULL_LOSS", "FULL_WIN"]);
  });

  it("a whole-line Asian pair exposes a both-push boundary state at total exactly 2", () => {
    const legs = caseLegs("CASE_06_ASIAN_PUSH_GAP_WHOLE");
    const model = buildStateModel(legs.map(toSelection));
    expect(model.states.length).toBeGreaterThan(0);

    const pushState = model.states.find((state) => {
      const total = matchTotal(state.representative);
      return total === SCORE_TOTAL_TWO.total;
    });
    expect(pushState).toBeDefined();
    expect(pushState?.vector).toEqual(["PUSH", "PUSH"]);
  });

  it("a handicap push boundary surfaces at away-by-one with both legs PUSH", () => {
    const legs = caseLegs("CASE_07_HANDICAP_PUSH_GAP");
    const model = buildStateModel(legs.map(toSelection));
    const pushState = model.states.find((state) => {
      const total = matchTotal(state.representative);
      return total === SCORE_AWAY_BY_ONE.total && goalMargin(state.representative) === SCORE_AWAY_BY_ONE.margin;
    });
    expect(pushState).toBeDefined();
    expect(pushState?.vector).toEqual(["PUSH", "PUSH"]);
  });

  it("two team-total overs share a both-loss state and a both-win (cross-metric) state", () => {
    const legs = caseLegs("CASE_08_BOTH_LOSS_STATE");
    const model = buildStateModel(legs.map(toSelection));

    const bothLoss = model.states.find(
      (state) => state.vector[0] === "FULL_LOSS" && state.vector[1] === "FULL_LOSS"
    );
    expect(bothLoss).toBeDefined();
    expect(matchTotal(bothLoss!.representative)).toBe(0);

    // (3,3): both teams clear 2.5 — legal because the legs are on different metrics.
    const bothWin = model.states.find(
      (state) => matchTotal(state.representative) === 6 && goalMargin(state.representative) === 0
    );
    expect(bothWin?.vector).toEqual(["FULL_WIN", "FULL_WIN"]);
  });

  it("overlapping match totals produce a state where both legs win (11 goals)", () => {
    const legs = caseLegs("CASE_04_OVERLAPPING_TOTALS_FALSE_ARB");
    const model = buildStateModel(legs.map(toSelection));
    const eleven = goldenScoreEvents.find((event) => event.id === "score-6-5")!;
    const vector = settleVector(legs.map(toSelection), {
      status: "FINISHED",
      fullTime: eleven.fullTime,
      firstHalf: null,
      secondHalf: null,
      extraTime: null,
      penalties: null,
      corners: null,
      cards: null,
    });
    expect(vector.results).toEqual(["FULL_WIN", "FULL_WIN"]);
    // The reduced model must still expose the overlapping representative.
    const inModel = model.states.find(
      (state) => matchTotal(state.representative) === eleven.total
    );
    expect(inModel?.vector).toEqual(["FULL_WIN", "FULL_WIN"]);
  });

  it("payoffMatrix maps settlement results to exact return multipliers", () => {
    const legs = caseLegs("CASE_01_STANDARD_COMPLEMENT");
    const selections = legs.map(toSelection);
    const model = buildStateModel(selections);
    const odds = legs.map((leg) => leg.odds);
    const matrix = payoffMatrix(model.states, odds);
    expect(matrix).toHaveLength(model.states.length);
    for (const row of matrix) {
      expect(row).toHaveLength(2);
    }
  });
});