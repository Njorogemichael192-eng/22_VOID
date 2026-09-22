import { describe, expect, it } from "vitest";

import {
  CURRENCY,
  countLabel,
  familyLabel,
  formatAge,
  formatDate,
  formatMoney,
  formatOdds,
  formatPercent,
  formatRoi,
  outcomeLabel,
  marketLabel,
  participantLabel,
  periodLabel,
  selectionLabel,
} from "./format";

describe("format helpers", () => {
  it("formats odds with two decimals", () => {
    expect(formatOdds(2.1)).toBe("2.10");
    expect(formatOdds(1)).toBe("1.00");
  });

  it("formats money with the currency prefix", () => {
    expect(formatMoney(105)).toBe("KSh 105.00");
    expect(formatMoney(1000.5)).toBe("KSh 1,000.50");
    expect(formatMoney(null)).toBe("—");
  });

  it("formats percentages and ROI", () => {
    expect(formatPercent(0.05)).toBe("5.00%");
    expect(formatRoi(0.0304)).toBe("+3.04%");
    expect(formatRoi(-0.01)).toBe("-1.00%");
    expect(formatRoi(null)).toBe("—");
  });

  it("renders relative ages", () => {
    const now = Date.parse("2026-09-22T12:00:00.000Z");
    expect(formatAge("2026-09-22T11:59:50.000Z", now)).toBe("10s ago");
    expect(formatAge("2026-09-22T11:58:00.000Z", now)).toBe("2m ago");
    expect(formatAge("2026-09-22T10:00:00.000Z", now)).toBe("2h ago");
    expect(formatAge("2026-09-18T12:00:00.000Z", now)).toBe("4d ago");
    expect(formatAge("2026-09-22T12:00:01.000Z", now)).toBe("just now");
  });

  it("formats dates without throwing", () => {
    const iso = new Date(2026, 8, 22, 19, 0).toISOString();
    const text = formatDate(iso);
    expect(text).toContain("2026");
    expect(text).toContain("19:00");
  });

  it("maps outcomes, participants, families and periods", () => {
    expect(outcomeLabel("OVER")).toBe("Over");
    expect(outcomeLabel("BTTS_YES")).toBe("Yes");
    expect(participantLabel("HOME")).toBe("Home");
    expect(participantLabel("AWAY")).toBe("Away");
    expect(participantLabel(null)).toBe("");
    expect(familyLabel("MATCH_TOTAL")).toBe("Goals over/under");
    expect(familyLabel("MYSTERY")).toBe("MYSTERY");
    expect(periodLabel("FIRST_HALF")).toBe("1st half");
    expect(periodLabel("FULL_MATCH")).toBe("Full time");
  });

  it("builds market and selection labels", () => {
    const market = {
      family: "MATCH_TOTAL",
      marketType: "GOALS_OVER_UNDER",
      period: "FULL_MATCH",
      participant: null,
      line: "2.5",
    };
    expect(marketLabel(market)).toBe("Goals over/under");
    expect(selectionLabel(market, "OVER")).toBe("Over 2.5");

    const asian = {
      family: "ASIAN_HANDICAP",
      marketType: "ASIAN_HANDICAP",
      period: "FULL_MATCH",
      participant: null,
      line: "0",
    };
    expect(selectionLabel(asian, "HOME")).toBe("Home");

    const teamHome = {
      family: "TEAM_TOTAL",
      marketType: "TEAM_TOTAL",
      period: "FIRST_HALF",
      participant: "HOME",
      line: "1.5",
    };
    expect(marketLabel(teamHome)).toBe("Home · Team goals · 1st half");
  });

  it("renders count labels", () => {
    expect(countLabel(1, "source", "sources")).toBe("1 source");
    expect(countLabel(3, "source", "sources")).toBe("3 sources");
  });

  it("exposes the currency symbol", () => {
    expect(CURRENCY).toBe("KSh");
  });
});
