import { describe, expect, it } from "vitest";

import { MarketFamily, MarketType, marketStructureKey, marketStructureSchema } from "./index.js";

describe("market taxonomy", () => {
  it("accepts a match result market", () => {
    const market = {
      family: MarketFamily.MATCH_RESULT,
      period: "FULL_MATCH",
      marketType: MarketType.ONE_X_TWO,
    };
    expect(marketStructureSchema.safeParse(market).success).toBe(true);
  });

  it("accepts an asian handicap market with participant and line", () => {
    const market = {
      family: MarketFamily.ASIAN_HANDICAP,
      period: "FULL_MATCH",
      marketType: MarketType.HANDICAP,
      participant: "HOME",
      line: "-0.75",
    };
    expect(marketStructureSchema.safeParse(market).success).toBe(true);
  });

  it("rejects a total market without a line", () => {
    expect(
      marketStructureSchema.safeParse({
        family: MarketFamily.MATCH_TOTAL,
        period: "FULL_MATCH",
        marketType: MarketType.STANDARD,
      }).success
    ).toBe(false);
  });

  it("rejects a handicap market without a participant", () => {
    expect(
      marketStructureSchema.safeParse({
        family: MarketFamily.ASIAN_HANDICAP,
        period: "FULL_MATCH",
        marketType: MarketType.HANDICAP,
        line: "-0.75",
      }).success
    ).toBe(false);
  });

  it("rejects a participant on a non-participant family", () => {
    expect(
      marketStructureSchema.safeParse({
        family: MarketFamily.MATCH_TOTAL,
        period: "FULL_MATCH",
        marketType: MarketType.STANDARD,
        participant: "HOME",
        line: "2.5",
      }).success
    ).toBe(false);
  });

  it("rejects a line on a family that never takes one", () => {
    expect(
      marketStructureSchema.safeParse({
        family: MarketFamily.BTTS,
        period: "FULL_MATCH",
        marketType: MarketType.BTTS,
        line: "0.5",
      }).success
    ).toBe(false);
  });

  it("rejects a marketType foreign to the family", () => {
    expect(
      marketStructureSchema.safeParse({
        family: MarketFamily.BTTS,
        period: "FULL_MATCH",
        marketType: MarketType.ASIAN,
      }).success
    ).toBe(false);
  });

  it("rejects a non-canonical line", () => {
    expect(
      marketStructureSchema.safeParse({
        family: MarketFamily.MATCH_TOTAL,
        period: "FULL_MATCH",
        marketType: MarketType.STANDARD,
        line: "two and a half",
      }).success
    ).toBe(false);
  });

  it("differentiates team markets by participant in the canonical key", () => {
    const home = marketStructureSchema.parse({
      family: MarketFamily.TEAM_TOTAL,
      period: "FULL_MATCH",
      marketType: MarketType.STANDARD,
      participant: "HOME",
      line: "1.5",
    });
    const away = marketStructureSchema.parse({
      family: MarketFamily.TEAM_TOTAL,
      period: "FULL_MATCH",
      marketType: MarketType.STANDARD,
      participant: "AWAY",
      line: "1.5",
    });
    expect(marketStructureKey(home)).not.toBe(marketStructureKey(away));
    expect(marketStructureKey(home)).toBe("TEAM_TOTAL|FULL_MATCH|STANDARD|HOME|1.5");
  });

  it("keeps football families distinct from one another", () => {
    const families = Object.values(MarketFamily);
    expect(new Set(families).size).toBe(families.length);
  });
});
