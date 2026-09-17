import { describe, expect, it } from "vitest";
import {
  MarketFamily,
  OpportunityStatus,
  Period,
  RejectionReason,
  ScoreFreshness,
  SelectionOutcome,
  SettlementResult,
} from "./index.js";

describe("canonical value sets", () => {
  it("defines the six settlement results", () => {
    expect(Object.values(SettlementResult)).toEqual([
      "FULL_WIN",
      "FULL_LOSS",
      "PUSH",
      "HALF_WIN",
      "HALF_LOSS",
      "VOID",
    ]);
  });

  it("defines freshness stages", () => {
    expect(ScoreFreshness.FRESH).toBe("FRESH");
    expect(ScoreFreshness.AGING).toBe("AGING");
    expect(ScoreFreshness.STALE).toBe("STALE");
  });

  it("defines the full opportunity lifecycle", () => {
    expect(OpportunityStatus.VERIFIED_ARB).toBe("VERIFIED_ARB");
    expect(OpportunityStatus.REJECTED).toBe("REJECTED");
  });

  it("includes all required rejection reasons", () => {
    for (const reason of [
      "UNKNOWN_SETTLEMENT",
      "EVENT_MISMATCH",
      "BOTH_LOSS_STATE",
      "NON_EXHAUSTIVE",
      "NON_EXCLUSIVE",
      "NEGATIVE_GUARANTEED_PROFIT",
      "STALE_ODDS",
      "INVALID_ODDS",
      "ROUNDING_DESTROYS_PROFIT",
      "EVENT_MATCH_UNCERTAIN",
    ]) {
      expect(Object.values(RejectionReason)).toContain(reason);
    }
  });

  it("defines distinct market families", () => {
    expect(MarketFamily.MATCH_TOTAL).not.toBe(MarketFamily.TEAM_TOTAL);
    expect(MarketFamily.MATCH_TOTAL).not.toBe(MarketFamily.ASIAN_TOTAL);
    expect(MarketFamily.CORNERS).toBe("CORNERS");
  });

  it("defines football periods", () => {
    expect(Period.FULL_MATCH).toBe("FULL_MATCH");
    expect(Period.FIRST_HALF).not.toBe(Period.FULL_MATCH);
  });

  it("defines selection outcomes", () => {
    expect(SelectionOutcome.HOME_OR_DRAW).toBe("HOME_OR_DRAW");
    expect(SelectionOutcome.OVER).not.toBe(SelectionOutcome.UNDER);
  });
});