import { describe, expect, it } from "vitest";

import { MarketFamily, MarketType, Period, Participant } from "@22void/domain";

import { formatCanonicalLine, marketIdentityKey, MarketNormalizer, toStructure } from "./market";
import type { MarketDescriptor } from "./market";

function descriptors(labels: string[]): MarketDescriptor[] {
  return labels.map((label, index) => ({
    provider: "test",
    sourceMarketId: `m${index}`,
    key: label,
    label,
    outcomes: [
      { name: "Over 2.5", point: "2.5" },
      { name: "Under 2.5", point: "2.5" },
    ],
  }));
}

function identities(labels: string[], normalizer = new MarketNormalizer()): string[] {
  return labels.map((label) => {
    const result = normalizer.normalize(descriptors([label])[0]!);
    expect(result.matched).toBe(true);
    return marketIdentityKey(result.resolution!);
  });
}

describe("formatCanonicalLine", () => {
  it("canonicalizes decimal lines", () => {
    expect(formatCanonicalLine("2.5")).toBe("2.5");
    expect(formatCanonicalLine("2,5")).toBe("2.5");
    expect(formatCanonicalLine("+1.5")).toBe("1.5");
    expect(formatCanonicalLine("-0.75")).toBe("-0.75");
    expect(formatCanonicalLine("2")).toBe("2");
  });

  it("rejects junk", () => {
    expect(formatCanonicalLine("abc")).toBeUndefined();
    expect(formatCanonicalLine("")).toBeUndefined();
    expect(formatCanonicalLine("2.5.0")).toBeUndefined();
  });
});

describe("equivalent markets normalize identically (spec §7)", () => {
  it('maps "Goals Over/Under", "Total Goals", "O/U", "Match Total" to MATCH_TOTAL / STANDARD', () => {
    const normalizer = new MarketNormalizer();
    for (const label of ["Goals Over/Under", "Total Goals", "O/U", "Match Total"]) {
      const result = normalizer.normalize(descriptors([label])[0]!);
      expect(result.resolution).toMatchObject({
        family: MarketFamily.MATCH_TOTAL,
        marketType: MarketType.STANDARD,
        period: Period.FULL_MATCH,
        line: "2.5",
      });
    }
  });

  it("produces identical identity keys for equivalent labels", () => {
    const normalizer = new MarketNormalizer();
    const keys = identities(
      ["Goals Over/Under", "Total Goals", "O/U", "Over Under 2.5 Goals"],
      normalizer
    );
    expect(new Set(keys)).toHaveLength(1);
  });
});

describe("non-equivalent markets never interchange (spec §7)", () => {
  it("keeps Goals O/U, Corners O/U, Cards O/U and Shots O/U distinct", () => {
    const normalizer = new MarketNormalizer();

    const goals = normalizer.normalize(descriptors(["Goals Over/Under"])[0]!);
    expect(goals.resolution!.family).toBe(MarketFamily.MATCH_TOTAL);

    const corners = normalizer.normalize(descriptors(["Corners Over/Under"])[0]!);
    expect(corners.resolution!.family).toBe(MarketFamily.CORNERS);

    const cards = normalizer.normalize(descriptors(["Cards Over/Under"])[0]!);
    expect(cards.resolution!.family).toBe(MarketFamily.CARDS);

    const shots = normalizer.normalize(descriptors(["Shots Over/Under"])[0]!);
    expect(shots.matched).toBe(false);
    expect(shots.reason).toContain("shots");
  });

  it('maps "Home/Away Team Goals O/U" to TEAM_TOTAL/<side> and never MATCH_TOTAL', () => {
    const normalizer = new MarketNormalizer();
    const home = normalizer.normalize(descriptors(["Home Team Goals O/U"])[0]!);
    expect(home.resolution!.family).toBe(MarketFamily.TEAM_TOTAL);
    expect(home.resolution!.participant).toBe(Participant.HOME);
    expect(home.resolution!.family).not.toBe(MarketFamily.MATCH_TOTAL);

    const away = normalizer.normalize(descriptors(["Away Team Goals O/U"])[0]!);
    expect(away.resolution!.family).toBe(MarketFamily.TEAM_TOTAL);
    expect(away.resolution!.participant).toBe(Participant.AWAY);
  });

  it("rejects draw-no-bet and player markets instead of guessing", () => {
    const normalizer = new MarketNormalizer();
    for (const label of ["Draw No Bet", "Anytime Goalscorer", "Player Shots"]) {
      const result = normalizer.normalize(descriptors([label])[0]!);
      expect(result.matched, label).toBe(false);
      expect(result.resolution).toBeUndefined();
    }
  });
});

describe("period normalization", () => {
  it("separates full match, first half and second half totals", () => {
    const normalizer = new MarketNormalizer();
    const full = normalizer.normalize(descriptors(["Full Match Over 1.5"])[0]!);
    const first = normalizer.normalize(descriptors(["1st Half Over 1.5"])[0]!);
    const second = normalizer.normalize(descriptors(["2nd Half Over 1.5"])[0]!);

    expect(full.resolution!.period).toBe(Period.FULL_MATCH);
    expect(first.resolution!.period).toBe(Period.FIRST_HALF);
    expect(second.resolution!.period).toBe(Period.SECOND_HALF);
  });
});

describe("asian market normalization", () => {
  it("maps Asian Total to ASIAN_TOTAL/ASIAN with the quarter line", () => {
    const normalizer = new MarketNormalizer();
    const result = normalizer.normalize({
      provider: "test",
      sourceMarketId: "m",
      key: "asian-total",
      label: "Asian Total Goals 2.25",
      outcomes: [{ name: "Over 2.25" }, { name: "Under 2.25" }],
    });
    expect(result.resolution).toMatchObject({
      family: MarketFamily.ASIAN_TOTAL,
      marketType: MarketType.ASIAN,
      line: "2.25",
    });
  });

  it("maps Home Asian Handicap to ASIAN_HANDICAP/HANDICAP/HOME with the negative line", () => {
    const normalizer = new MarketNormalizer();
    const result = normalizer.normalize({
      provider: "test",
      sourceMarketId: "m",
      key: "asian-handicap-home",
      label: "Home Asian Handicap -0.75",
      outcomes: [{ name: "AC Milan -0.75" }, { name: "Inter Milan +0.75" }],
    });
    expect(result.resolution).toMatchObject({
      family: MarketFamily.ASIAN_HANDICAP,
      marketType: MarketType.HANDICAP,
      participant: Participant.HOME,
      line: "-0.75",
    });
  });

  it("maps Team Asian Totals to TEAM_ASIAN_TOTAL with the side", () => {
    const normalizer = new MarketNormalizer();
    const result = normalizer.normalize({
      provider: "test",
      sourceMarketId: "m",
      key: "team-asian-total-away",
      label: "Away Team Asian Total 1.75",
      outcomes: [{ name: "Over 1.75" }, { name: "Under 1.75" }],
    });
    expect(result.resolution).toMatchObject({
      family: MarketFamily.TEAM_ASIAN_TOTAL,
      marketType: MarketType.ASIAN,
      participant: Participant.AWAY,
      line: "1.75",
    });
  });
});

describe("1X2 / double chance / BTTS / exact score", () => {
  it("normalizes the fixed-odds families", () => {
    const normalizer = new MarketNormalizer();
    const oneXTwo = normalizer.normalize(descriptors(["1X2"])[0]!);
    expect(oneXTwo.resolution).toMatchObject({
      family: MarketFamily.MATCH_RESULT,
      marketType: MarketType.ONE_X_TWO,
      period: Period.FULL_MATCH,
    });

    const doubleChance = normalizer.normalize(descriptors(["Double Chance"])[0]!);
    expect(doubleChance.resolution!.family).toBe(MarketFamily.DOUBLE_CHANCE);

    const btts = normalizer.normalize(descriptors(["Both Teams to Score"])[0]!);
    expect(btts.resolution!.family).toBe(MarketFamily.BTTS);
    expect(btts.resolution!.marketType).toBe(MarketType.BTTS);
  });

  it("treats Correct Score and Exact Score as the same family", () => {
    const normalizer = new MarketNormalizer();
    const correct = normalizer.normalize(descriptors(["Correct Score"])[0]!);
    const exact = normalizer.normalize(descriptors(["Exact Score"])[0]!);
    expect(correct.resolution!.family).toBe(MarketFamily.EXACT_SCORE);
    expect(marketIdentityKey(correct.resolution!)).toBe(marketIdentityKey(exact.resolution!));
  });
});

describe("key registry path (provider-native keys)", () => {
  function keyedNormalizer() {
    const normalizer = new MarketNormalizer();
    normalizer.addKey("odds-api", "h2h", {
      family: MarketFamily.MATCH_RESULT,
      marketType: MarketType.ONE_X_TWO,
      period: Period.FULL_MATCH,
    });
    normalizer.addKey("odds-api", "totals", {
      family: MarketFamily.MATCH_TOTAL,
      marketType: MarketType.STANDARD,
      period: Period.FULL_MATCH,
    });
    normalizer.addKey("odds-api", "team_totals_home", {
      family: MarketFamily.TEAM_TOTAL,
      marketType: MarketType.STANDARD,
      period: Period.FULL_MATCH,
      participant: Participant.HOME,
    });
    normalizer.addKey("odds-api", "h2h_1st_half", {
      family: MarketFamily.MATCH_RESULT,
      marketType: MarketType.ONE_X_TWO,
      period: Period.FIRST_HALF,
    });
    return normalizer;
  }

  it("resolves a key to its canonical identity via the key path", () => {
    const normalizer = keyedNormalizer();
    const h2h = normalizer.normalize({
      provider: "odds-api",
      sourceMarketId: "m1",
      key: "h2h",
      label: "Match Result",
    });
    expect(h2h.matched).toBe(true);
    expect(h2h.resolution!.family).toBe(MarketFamily.MATCH_RESULT);
    expect(h2h.resolution!.via).toBe("key");

    const firstHalf = normalizer.normalize({
      provider: "odds-api",
      sourceMarketId: "m2",
      key: "h2h_1st_half",
    });
    expect(firstHalf.resolution!.period).toBe(Period.FIRST_HALF);
  });

  it("fills a missing line from outcome points for line-requiring families", () => {
    const normalizer = keyedNormalizer();
    const totals = normalizer.normalize({
      provider: "odds-api",
      sourceMarketId: "m3",
      key: "totals",
      outcomes: [
        { name: "Over 2.5", point: "2.5" },
        { name: "Under 2.5", point: "2.5" },
      ],
    });
    expect(totals.resolution).toMatchObject({
      family: MarketFamily.MATCH_TOTAL,
      line: "2.5",
    });
  });

  it("keeps provider key namespaces isolated", () => {
    const normalizer = keyedNormalizer();
    const wrong = normalizer.normalize({
      provider: "parlay-api",
      sourceMarketId: "m9",
      key: "h2h",
    });
    expect(wrong.matched).toBe(false); // parlay-api has no h2h key registered
  });
});

describe("line-aware structure validation", () => {
  it("validates a resolution into a canonical structure when the line exists", () => {
    const normalizer = new MarketNormalizer();
    const result = normalizer.normalize(descriptors(["Total Goals"])[0]!);
    const structure = toStructure(result.resolution!);
    expect(structure).toMatchObject({
      family: MarketFamily.MATCH_TOTAL,
      marketType: MarketType.STANDARD,
      period: Period.FULL_MATCH,
      line: "2.5",
    });
  });

  it("cannot form a structure without a required line or participant", () => {
    const normalizer = new MarketNormalizer();
    const noLine = normalizer.normalize({
      provider: "test",
      sourceMarketId: "m",
      key: "totals",
      label: "Total Goals",
    });
    expect(noLine.resolution!.reasons.join(" ")).toContain("line not provided");
    expect(toStructure(noLine.resolution!)).toBeUndefined();

    const noSide = normalizer.normalize({
      provider: "test",
      sourceMarketId: "m",
      key: "ah",
      label: "Asian Handicap -1.5",
      outcomes: [{ name: "-1.5" }, { name: "+1.5" }],
    });
    expect(noSide.resolution!.reasons.join(" ")).toContain("participant not specified");
    expect(toStructure(noSide.resolution!)).toBeUndefined();
  });
});

describe("line canonicalization across raw provider styles", () => {
  it("normalizes comma decimals and plus-prefixed handicaps", () => {
    const normalizer = new MarketNormalizer();
    const comma = normalizer.normalize({
      provider: "test",
      sourceMarketId: "m",
      key: "totals",
      label: "Over/Under 1,5 goals",
    });
    expect(comma.resolution!.line).toBe("1.5");

    const plus = normalizer.normalize({
      provider: "test",
      sourceMarketId: "m",
      key: "hcap",
      label: "Asian Handicap +1.5",
      outcomes: [{ name: "+1.5" }, { name: "-1.5" }],
    });
    expect(plus.resolution!.line).toBe("1.5");
  });
});
