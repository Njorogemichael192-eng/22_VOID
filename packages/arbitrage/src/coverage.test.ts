import {
  MarketFamily,
  MarketType,
  Participant,
  Period,
  RejectionReason,
  SettlementResult,
} from "@22void/domain";
import type { SettleableSelection } from "@22void/settlement";
import { describe, expect, it } from "vitest";

import { detectFalseArb, formatCoverageReport, formatRejection } from "./coverage.js";
import type { ArbitrageLeg } from "./coverage.js";

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

function leg(sel: SettleableSelection, odds = 2.0, id?: string): ArbitrageLeg {
  legCounter += 1;
  return { id: id ?? `leg-${legCounter}`, selection: sel, odds };
}

function matchTotal(overUnder: "OVER" | "UNDER", line: string, odds = 2.0): ArbitrageLeg {
  return leg(selection(MarketFamily.MATCH_TOTAL, MarketType.STANDARD, overUnder, { line }), odds);
}

function teamTotal(
  participant: Participant,
  overUnder: "OVER" | "UNDER",
  line: string,
  odds = 2.0
): ArbitrageLeg {
  return leg(
    selection(MarketFamily.TEAM_TOTAL, MarketType.STANDARD, overUnder, { line, participant }),
    odds
  );
}

describe("detectFalseArb — golden cases (spec §70)", () => {
  it("CASE-001/002: complementary Over/Under 2.5 is structurally covered", () => {
    for (const odds of [2.1, 2.2]) {
      const report = detectFalseArb([
        matchTotal("OVER", "2.5", odds),
        matchTotal("UNDER", "2.5", 2.1),
      ]);
      expect(report.status).toBe("COVERED");
      expect(report.exclusive).toBe(true);
      expect(report.exhaustive).toBe(true);
      expect(report.rejections).toEqual([]);
    }
  });

  it("CASE-003: Over 10.5 + Under 13.5 is rejected due to overlap", () => {
    const report = detectFalseArb([matchTotal("OVER", "10.5"), matchTotal("UNDER", "13.5")]);
    expect(report.status).toBe("REJECTED");
    expect(report.exclusive).toBe(false);
    expect(report.exhaustive).toBe(true);
    expect(report.rejections.map((verdict) => verdict.reason)).toContain(
      RejectionReason.NON_EXCLUSIVE
    );
    expect(report.overlaps.some((overlap) => overlap.kind === "SAME_METRIC")).toBe(true);
  });

  it("CASE-004: Home Under 1.5 + Match Over 1.5 is structurally exhaustive", () => {
    const report = detectFalseArb([
      teamTotal(Participant.HOME, "UNDER", "1.5"),
      matchTotal("OVER", "1.5"),
    ]);
    expect(report.status).toBe("COVERED");
    expect(report.exhaustive).toBe(true);
    expect(report.exclusive).toBe(true);
    expect(report.overlaps.some((overlap) => overlap.kind === "CROSS_METRIC")).toBe(true);
    expect(report.overlaps.some((overlap) => overlap.kind === "SAME_METRIC")).toBe(false);
  });

  it("CASE-005: Over 1.0 + Under 1.5 keeps push-aware states", () => {
    const report = detectFalseArb([matchTotal("OVER", "1.0"), matchTotal("UNDER", "1.5")]);
    expect(report.status).toBe("COVERED");
    expect(report.exhaustive).toBe(true);
    expect(report.states.some((state) => state.vector[0] === SettlementResult.PUSH)).toBe(true);
  });

  it("§21/§31: cross-metric three-leg structures are allowed", () => {
    const report = detectFalseArb([
      teamTotal(Participant.HOME, "OVER", "1.5"),
      teamTotal(Participant.AWAY, "OVER", "1.5"),
      matchTotal("UNDER", "3.5"),
    ]);
    expect(report.status).toBe("COVERED");
    expect(report.exhaustive).toBe(true);
    expect(report.exclusive).toBe(true);
    expect(
      report.states.some(
        (state) => state.vector.filter((r) => r === SettlementResult.FULL_WIN).length >= 2
      )
    ).toBe(true);
  });
});

describe("detectFalseArb — coverage failures", () => {
  it("detects both-loss states (§28)", () => {
    const report = detectFalseArb([
      teamTotal(Participant.HOME, "OVER", "2.5"),
      teamTotal(Participant.AWAY, "OVER", "2.5"),
    ]);
    expect(report.status).toBe("REJECTED");
    expect(report.exhaustive).toBe(false);
    expect(report.gaps.length).toBeGreaterThan(0);
    const verdict = report.rejections.find(
      (entry) => entry.reason === RejectionReason.BOTH_LOSS_STATE
    );
    expect(verdict).toBeDefined();
    expect(verdict?.evidence.settlements).toEqual([
      SettlementResult.FULL_LOSS,
      SettlementResult.FULL_LOSS,
    ]);
  });

  it("detects a push/gap state", () => {
    const report = detectFalseArb([matchTotal("OVER", "2.0"), matchTotal("UNDER", "1.5")]);
    expect(report.status).toBe("REJECTED");
    expect(report.exhaustive).toBe(false);
    expect(report.exclusive).toBe(true);
    expect(report.rejections.map((verdict) => verdict.reason)).toContain(
      RejectionReason.NON_EXHAUSTIVE
    );
    expect(report.gaps.some((gap) => gap.settlements[0] === SettlementResult.PUSH)).toBe(true);
  });
});

describe("detectFalseArb — pruning reasons", () => {
  it("rejects unknown settlement instead of guessing (Rule 3)", () => {
    const extraTime = leg(
      selection(MarketFamily.MATCH_TOTAL, MarketType.STANDARD, "OVER", {
        line: "1.5",
        period: Period.EXTRA_TIME,
      })
    );
    const report = detectFalseArb([extraTime, matchTotal("OVER", "2.5")]);
    expect(report.status).toBe("REJECTED");
    expect(report.rejections[0]?.reason).toBe(RejectionReason.UNKNOWN_SETTLEMENT);
    expect(report.unknown).toHaveLength(1);
    expect(report.rejections[0]?.evidence.unknown?.[0]?.reason).toContain("NO_STATE_MODEL");
  });

  it("rejects duplicate selections", () => {
    const duplicated = () =>
      selection(MarketFamily.MATCH_TOTAL, MarketType.STANDARD, "OVER", { line: "2.5" });
    const report = detectFalseArb([leg(duplicated(), 2.0, "a"), leg(duplicated(), 2.0, "b")]);
    expect(report.status).toBe("REJECTED");
    expect(report.rejections[0]?.reason).toBe(RejectionReason.INVALID_MARKET);
    expect(report.rejections[0]?.evidence.legIds).toEqual(["a", "b"]);
  });

  it("rejects an empty candidate", () => {
    const report = detectFalseArb([]);
    expect(report.status).toBe("REJECTED");
    expect(report.rejections[0]?.reason).toBe(RejectionReason.INVALID_MARKET);
  });
});

describe("detectFalseArb — partitions and reporting", () => {
  it("accepts a 1X2 three-way partition", () => {
    const report = detectFalseArb([
      leg(selection(MarketFamily.MATCH_RESULT, MarketType.ONE_X_TWO, "HOME")),
      leg(selection(MarketFamily.MATCH_RESULT, MarketType.ONE_X_TWO, "DRAW")),
      leg(selection(MarketFamily.MATCH_RESULT, MarketType.ONE_X_TWO, "AWAY")),
    ]);
    expect(report.status).toBe("COVERED");
    expect(report.exclusive).toBe(true);
    expect(report.exhaustive).toBe(true);
  });

  it("aligns state vectors with the input legs", () => {
    const report = detectFalseArb([matchTotal("OVER", "2.5"), matchTotal("UNDER", "2.5")]);
    expect(report.selectionIndices).toEqual([0, 1]);
    for (const state of report.states) expect(state.vector).toHaveLength(2);
  });

  it("formats rejections and coverage reports", () => {
    const report = detectFalseArb([matchTotal("OVER", "10.5"), matchTotal("UNDER", "13.5")]);
    const verdict = report.rejections[0]!;
    expect(formatRejection(verdict)).toContain(RejectionReason.NON_EXCLUSIVE);
    expect(formatRejection(verdict)).toContain("settlements:");
    expect(formatCoverageReport(report)).toContain("REJECTED");
    expect(
      formatCoverageReport(detectFalseArb([matchTotal("OVER", "2.5"), matchTotal("UNDER", "2.5")]))
    ).toContain("COVERED");
  });
});
