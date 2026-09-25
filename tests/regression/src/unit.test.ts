import {
  classifyFreshness,
  DEFAULT_FRESHNESS_POLICY,
  EventStatus,
  returnMultiplier,
  SettlementResult,
} from "@22void/domain";
import type { PricedSelection } from "@22void/arbitrage";
import { relativeDelta, priceAge } from "@22void/arbitrage";
import {
  componentPayouts,
  formatLine,
  lineKind,
  parseCanonicalLine,
  payout,
  settleSelection,
  splitAsianLine,
} from "@22void/settlement";
import type { LineScore, SettleAssessment, SettleableSelection } from "@22void/settlement";
import { describe, expect, it } from "vitest";

import { settlementGoldenRows } from "../../../tests/fixtures/regression/index.js";

describe("Phase 17 unit regression: settlement payout formulas (§10)", () => {
  it("returnMultiplier implements the spec table for every result", () => {
    expect(returnMultiplier(SettlementResult.FULL_WIN, 2.5)).toBe(2.5);
    expect(returnMultiplier(SettlementResult.FULL_LOSS, 2.5)).toBe(0);
    expect(returnMultiplier(SettlementResult.HALF_WIN, 2.5)).toBe(1.75);
    expect(returnMultiplier(SettlementResult.HALF_LOSS, 2.5)).toBe(0.5);
    expect(returnMultiplier(SettlementResult.PUSH, 2.5)).toBe(1);
    expect(returnMultiplier(SettlementResult.VOID, 2.5)).toBe(1);
  });

  it("payout is stake × returnMultiplier", () => {
    expect(payout(100, 2.5, SettlementResult.FULL_WIN)).toBe(250);
    expect(payout(100, 2.5, SettlementResult.HALF_WIN)).toBe(175);
    expect(payout(100, 2.5, SettlementResult.HALF_LOSS)).toBe(50);
    expect(payout(100, 2.5, SettlementResult.PUSH)).toBe(100);
  });

  it("componentPayouts sums exactly to payout for quarter-line splits", () => {
    const assessment: SettleAssessment = {
      state: { result: "HALF_LOSS", components: ["PUSH", "LOSS"] },
      notes: [],
    };
    const parts = componentPayouts(assessment, 100, 2.4);
    expect(parts).toEqual([50, 0]);
    expect(parts.reduce((sum, value) => sum + value, 0)).toBe(payout(100, 2.4, "HALF_LOSS"));

    const halfWin: SettleAssessment = {
      state: { result: "HALF_WIN", components: ["WIN", "PUSH"] },
      notes: [],
    };
    const partsWin = componentPayouts(halfWin, 100, 1.8);
    expect(partsWin).toEqual([90, 50]);
    expect(partsWin.reduce((sum, value) => sum + value, 0)).toBe(
      payout(100, 1.8, "HALF_WIN")
    );
  });

  it("every golden settlement row reproduces its expected multiplier", () => {
    for (const row of settlementGoldenRows) {
      const score = row.scores;
      const match = {
        status: row.status === "POSTPONED" ? EventStatus.POSTPONED : EventStatus.FINISHED,
        fullTime: score.fullTime as LineScore,
        firstHalf: (score.firstHalf ?? null) as LineScore | null,
        secondHalf: null,
        extraTime: null,
        penalties: null,
        corners: null,
        cards: null,
      };
      const settled = settleSelection(row.selection as SettleableSelection, match);
      expect(settled.kind, row.id).toBe("settled");
      if (settled.kind !== "settled") continue;
      const { state } = settled.assessment;
      expect(state.result, row.id).toBe(row.expected.result);
      if (row.expected.components !== undefined) {
        expect(state.components, row.id).toEqual(row.expected.components);
      }
      expect(payout(100, row.selection.odds, state.result)).toBeCloseTo(
        row.expected.payoutPer100,
        6
      );
    }
  });

  it("a POSTPONED event voids every selection with stake returned", () => {
    const settled = settleSelection(
      {
        family: "MATCH_TOTAL",
        marketType: "STANDARD",
        period: "FULL_MATCH",
        line: "2.5",
        outcome: "OVER",
      },
      {
        status: EventStatus.POSTPONED,
        fullTime: null,
        firstHalf: null,
        secondHalf: null,
        extraTime: null,
        penalties: null,
        corners: null,
        cards: null,
      }
    );
    expect(settled.kind).toBe("settled");
    if (settled.kind !== "settled") return;
    expect(settled.assessment.state.result).toBe("VOID");
    expect(payout(100, 2.0, settled.assessment.state.result)).toBe(100);
  });
});

describe("Phase 17 unit regression: line math (§12–§14)", () => {
  it("parseCanonicalLine / formatLine round-trip canonical values", () => {
    for (const value of [0, 1, -1, 2.5, -0.75, 2.25]) {
      const formatted = formatLine(value);
      expect(parseCanonicalLine(formatted)).toBe(value);
    }
    expect(formatLine(0)).toBe("0");
    expect(formatLine(-1)).toBe("-1");
    expect(parseCanonicalLine("junk")).toBeUndefined();
  });

  it("lineKind classifies whole, half and quarter lines", () => {
    expect(lineKind(2)).toBe("whole");
    expect(lineKind(2.5)).toBe("half");
    expect(lineKind(2.25)).toBe("quarter");
    expect(lineKind(0.75)).toBe("quarter");
    expect(lineKind(-1)).toBe("whole");
  });

  it("splitAsianLine decomposes quarter lines 50/50 and passes others through", () => {
    expect(splitAsianLine("2.25")).toEqual(["2", "2.5"]);
    expect(splitAsianLine("2.75")).toEqual(["2.5", "3"]);
    expect(splitAsianLine("0.75")).toEqual(["0.5", "1"]);
    expect(splitAsianLine("-0.75")).toEqual(["-1", "-0.5"]);
    expect(splitAsianLine("2.0")).toEqual(["2.0"]);
    expect(splitAsianLine("2.5")).toEqual(["2.5"]);
    expect(splitAsianLine("bad")).toBeUndefined();
  });
});

describe("Phase 17 unit regression: freshness and price movement (§38–§39)", () => {
  it("classifyFreshness bands age zero as FRESH and huge ages as STALE", () => {
    expect(classifyFreshness(0, DEFAULT_FRESHNESS_POLICY)).toBe("FRESH");
    const max = Number.MAX_SAFE_INTEGER / 2;
    expect(classifyFreshness(max, DEFAULT_FRESHNESS_POLICY)).toBe("STALE");
  });

  it("relativeDelta is the relative price movement, never negative", () => {
    expect(relativeDelta(2.0, 2.1)).toBeCloseTo(0.05, 9);
    expect(relativeDelta(2.1, 2.0)).toBeCloseTo(0.047619, 6);
  });

  it("priceAge prefers sourceUpdatedAt and falls back to observedAt", () => {
    const now = Date.parse("2026-09-20T12:00:00.000Z");
    const withSource: PricedSelection = {
      id: "l",
      eventId: "e",
      selection: {
        family: "MATCH_TOTAL",
        marketType: "STANDARD",
        period: "FULL_MATCH",
        line: "2.5",
        outcome: "OVER",
      },
      odds: 2.0,
      bookmaker: "b",
      observedAt: now,
      sourceUpdatedAt: new Date(now - 5_000).toISOString(),
    };
    expect(priceAge(withSource, now)).toBe(5_000);

    const withoutSource: PricedSelection = {
      id: "m",
      eventId: "e",
      selection: {
        family: "MATCH_TOTAL",
        marketType: "STANDARD",
        period: "FULL_MATCH",
        line: "2.5",
        outcome: "OVER",
      },
      odds: 2.0,
      bookmaker: "b",
      observedAt: now - 10_000,
    };
    expect(priceAge(withoutSource, now)).toBe(10_000);
  });
});