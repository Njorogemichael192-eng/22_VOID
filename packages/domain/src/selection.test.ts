import { describe, expect, it } from "vitest";

import { canonicalSelectionSchema, MarketFamily } from "./index.js";

const selection = {
  selectionId: "sel-0001",
  market: {
    family: MarketFamily.MATCH_RESULT,
    period: "FULL_MATCH",
    marketType: "1X2",
  },
  bookmakerId: "bm-001",
  oddsSourceId: "provider-a",
  outcome: "HOME",
  odds: 2.1,
  observedAt: "2026-09-17T12:00:00.000Z",
  sourceUpdatedAt: "2026-09-17T11:59:58.000Z",
};

describe("selection taxonomy", () => {
  it("accepts a valid match-result selection", () => {
    expect(canonicalSelectionSchema.safeParse(selection).success).toBe(true);
  });

  it("rejects an outcome foreign to the family", () => {
    expect(canonicalSelectionSchema.safeParse({ ...selection, outcome: "BTTS_YES" }).success).toBe(
      false
    );
  });

  it("accepts every double-chance outcome", () => {
    for (const outcome of ["HOME_OR_DRAW", "AWAY_OR_DRAW", "HOME_OR_AWAY"]) {
      expect(
        canonicalSelectionSchema.safeParse({
          ...selection,
          market: { family: "DOUBLE_CHANCE", period: "FULL_MATCH", marketType: "DOUBLE_CHANCE" },
          outcome,
        }).success
      ).toBe(true);
    }
  });

  it("accepts an exact-score outcome as a scoreline", () => {
    expect(
      canonicalSelectionSchema.safeParse({
        ...selection,
        market: {
          family: MarketFamily.EXACT_SCORE,
          period: "FULL_MATCH",
          marketType: "EXACT_SCORE",
        },
        outcome: "2-1",
      }).success
    ).toBe(true);
  });

  it("rejects a non-scoreline outcome on an exact-score market", () => {
    expect(
      canonicalSelectionSchema.safeParse({
        ...selection,
        market: {
          family: MarketFamily.EXACT_SCORE,
          period: "FULL_MATCH",
          marketType: "EXACT_SCORE",
        },
        outcome: "HOME",
      }).success
    ).toBe(false);
  });

  it("rejects odds at or below the minimum", () => {
    expect(canonicalSelectionSchema.safeParse({ ...selection, odds: 1 }).success).toBe(false);
  });

  it("rejects observedAt before sourceUpdatedAt", () => {
    const backward = {
      ...selection,
      observedAt: "2026-09-17T11:59:50.000Z",
      sourceUpdatedAt: "2026-09-17T11:59:58.000Z",
    };
    expect(canonicalSelectionSchema.safeParse(backward).success).toBe(false);
  });
});
