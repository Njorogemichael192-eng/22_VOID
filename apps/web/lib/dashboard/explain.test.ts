import { describe, expect, it } from "vitest";
import type { OpportunityView } from "@22void/db";

import {
  arbitrageEvidence,
  freshnessEvidence,
  isArbStatus,
  opportunityEvidence,
  rejectionEvidence,
  settlementEvidence,
  structureEvidence,
  winCondition,
} from "./explain";
import { formatMoney } from "./format";

const now = Date.parse("2026-09-22T12:00:00.000Z");

const opp: OpportunityView = {
  id: "opp_1",
  event: {
    id: "evt_1",
    competition: "League",
    homeTeam: "Home",
    awayTeam: "Away",
    startTime: "2026-10-01T19:00:00.000Z",
    status: "SCHEDULED",
  },
  status: "VERIFIED_ARB",
  rejectionReason: null,
  marketStructure: "SAME_MARKET_COMPLEMENT",
  totalStake: 100,
  minReturn: 105,
  guaranteedProfit: 5,
  roi: 0.05,
  worstState: null,
  engineVersion: "1.2.0",
  normalizerVersion: "1.0.0",
  settlementVersion: "1.0.0",
  optimizerVersion: "1.0.0",
  detectedAt: "2026-09-22T11:59:40.000Z",
  validatedAt: "2026-09-22T11:59:45.000Z",
  expiresAt: "2026-09-22T12:00:15.000Z",
  legs: [
    {
      id: "oleg_1",
      selectionId: "sel_over",
      bookmaker: "Pinnacle",
      market: {
        family: "MATCH_TOTAL",
        marketType: "GOALS_OVER_UNDER",
        period: "FULL_MATCH",
        participant: null,
        line: "2.5",
      },
      outcome: "OVER",
      oddsSnapshot: 2.1,
      stake: 50,
      guaranteedReturn: 105,
      settlementResult: null,
    },
  ],
};

describe("winCondition", () => {
  it("reads match-result outcomes", () => {
    expect(winCondition({ family: "MATCH_RESULT", line: null }, "HOME")).toBe("Home win");
    expect(winCondition({ family: "MATCH_RESULT", line: null }, "AWAY")).toBe("Away win");
    expect(winCondition({ family: "MATCH_RESULT", line: null }, "DRAW")).toBe("Draw");
  });

  it("reads total lines with subjects", () => {
    expect(winCondition({ family: "MATCH_TOTAL", line: "2.5" }, "OVER")).toBe(
      "Over 2.5 match totals"
    );
    expect(winCondition({ family: "TEAM_TOTAL", line: "1.5", participant: "HOME" }, "OVER")).toBe(
      "Over 1.5 home team totals"
    );
  });

  it("reads BTTS, double chance and exact score", () => {
    expect(winCondition({ family: "BTTS" }, "BTTS_YES")).toBe("Both teams score");
    expect(winCondition({ family: "DOUBLE_CHANCE", line: null }, "HOME_OR_AWAY")).toBe(
      "Any team wins (no draw)"
    );
    expect(winCondition({ family: "EXACT_SCORE", line: "2-1" }, ""));
  });
});

describe("isArbStatus", () => {
  it("accepts the three arb statuses and nothing else", () => {
    expect(isArbStatus("VERIFIED_ARB")).toBe(true);
    expect(isArbStatus("FRESH_ARB")).toBe(true);
    expect(isArbStatus("THEORETICAL_ARB")).toBe(true);
    expect(isArbStatus("REJECTED")).toBe(false);
    expect(isArbStatus("STALE")).toBe(false);
  });
});

describe("evidence builders", () => {
  it("builds the guaranteed-return evidence from the solved plan", () => {
    const section = arbitrageEvidence(opp);
    expect(section.tone).toBe("positive");
    expect(section.summary).toContain(formatMoney(105));
    expect(section.summary).toContain(formatMoney(5));
    expect(section.points[0]).toContain("Pinnacle");
  });

  it("describes named structures and falls back safely", () => {
    expect(structureEvidence("PARTITION").summary).toBe("Market partition");
    expect(structureEvidence(null).points.length).toBeGreaterThan(0);
  });

  it("explains settlement coverage per leg", () => {
    const section = settlementEvidence(opp);
    expect(section.title).toBe("Settlement coverage");
    expect(section.points[0]).toContain("Over 2.5");
  });

  it("explains every rejection reason with headline and code", () => {
    const rejected: OpportunityView = {
      ...opp,
      status: "REJECTED",
      rejectionReason: "CROSS_SOURCE_TIMESTAMP_SPREAD",
    };
    const section = rejectionEvidence(rejected);
    expect(section.tone).toBe("negative");
    expect(section.summary).toBe("Prices not contemporaneous");
    expect(section.points).toContain("Reason code: CROSS_SOURCE_TIMESTAMP_SPREAD");
  });

  it("flags expired recheck windows in freshness", () => {
    const staleOpp: OpportunityView = {
      ...opp,
      status: "STALE",
      expiresAt: "2026-09-22T11:59:50.000Z",
    };
    const section = freshnessEvidence(staleOpp, now);
    expect(section.tone).toBe("negative");
    expect(section.points.some((point) => point.includes("recheck window closed"))).toBe(true);
  });

  it("orders sections by positive evidence then freshness", () => {
    const sections = opportunityEvidence(opp, now);
    expect(sections[0]?.title).toBe("Positive guaranteed return");
    expect(sections[1]?.title).toBe("Market structure");
    expect(sections[2]?.title).toBe("Settlement coverage");
    expect(sections[3]?.title).toBe("Freshness");
  });

  it("shows only rejection evidence for invalidated opportunities", () => {
    const invalidated: OpportunityView = {
      ...opp,
      status: "INVALIDATED",
      rejectionReason: "PRICE_CHANGED_ON_RECHECK",
    };
    const sections = opportunityEvidence(invalidated, now);
    expect(sections[0]?.title).toBe("Why this is not an opportunity");
    expect(sections.every((section) => section.title !== "Positive guaranteed return")).toBe(true);
  });

  it("renders positive evidence even for theoretical arbs", () => {
    const theoretical: OpportunityView = { ...opp, status: "THEORETICAL_ARB", validatedAt: null };
    const sections = opportunityEvidence(theoretical, now);
    expect(sections[0]?.title).toBe("Positive guaranteed return");
  });
});
