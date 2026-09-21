import { MarketFamily, MarketType, Participant, Period } from "@22void/domain";
import type { SettleableSelection } from "@22void/settlement";
import { describe, expect, it } from "vitest";

import {
  bestPricePerSelection,
  classifyStructure,
  familiesCompatible,
  formatPruneVerdict,
  generateCandidates,
  isStandardComplement,
  pruneCandidate,
  scanCandidates,
} from "./candidates.js";
import type { Candidate, PricedSelection } from "./candidates.js";

let counter = 0;

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

function matchTotal(overUnder: "OVER" | "UNDER", line: string, odds: number, book = "book-a") {
  counter += 1;
  return priced(
    selection(MarketFamily.MATCH_TOTAL, MarketType.STANDARD, overUnder, { line }),
    odds,
    book
  );
}

function teamTotal(
  participant: Participant,
  overUnder: "OVER" | "UNDER",
  line: string,
  odds: number,
  book = "book-a"
) {
  counter += 1;
  return priced(
    selection(MarketFamily.TEAM_TOTAL, MarketType.STANDARD, overUnder, { line, participant }),
    odds,
    book
  );
}

function priced(
  sel: SettleableSelection,
  odds: number,
  bookmaker: string,
  eventId = "event-1",
  extra: Partial<PricedSelection> = {}
): PricedSelection {
  counter += 1;
  return { id: `p-${counter}`, eventId, selection: sel, odds, bookmaker, ...extra };
}

function legIds(candidate: Candidate): string[] {
  return candidate.legs.map((leg) => leg.id);
}

describe("familiesCompatible", () => {
  it("allows same-family and the spec's cross-family pairs", () => {
    expect(familiesCompatible(MarketFamily.MATCH_TOTAL, MarketFamily.MATCH_TOTAL)).toBe(true);
    expect(familiesCompatible(MarketFamily.MATCH_TOTAL, MarketFamily.TEAM_TOTAL)).toBe(true);
    expect(familiesCompatible(MarketFamily.MATCH_RESULT, MarketFamily.DOUBLE_CHANCE)).toBe(true);
    expect(familiesCompatible(MarketFamily.MATCH_TOTAL, MarketFamily.BTTS)).toBe(true);
  });

  it("refuses families without a shared state model", () => {
    expect(familiesCompatible(MarketFamily.CORNERS, MarketFamily.CARDS)).toBe(false);
    expect(familiesCompatible(MarketFamily.CORNERS, MarketFamily.MATCH_TOTAL)).toBe(false);
    expect(familiesCompatible(MarketFamily.BTTS, MarketFamily.ASIAN_HANDICAP)).toBe(false);
  });
});

describe("generateCandidates — staged generation", () => {
  it("groups by event and period, never mixing them", () => {
    const batch = [
      matchTotal("OVER", "2.5", 2.2),
      matchTotal("UNDER", "2.5", 2.1),
      priced(
        selection(MarketFamily.MATCH_TOTAL, MarketType.STANDARD, "OVER", { line: "1.5" }),
        2.0,
        "book-b",
        "event-1",
        { id: "fh-over" }
      ),
    ];
    // Force a first-half period on the extra leg.
    batch[2]!.selection = {
      ...batch[2]!.selection,
      period: Period.FIRST_HALF,
    };

    const candidates = generateCandidates(batch, { eventId: "event-1" });
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(candidate.eventId).toBe("event-1");
      expect(candidate.legs.every((leg) => leg.eventId === "event-1")).toBe(true);
      expect(candidate.legs.every((leg) => leg.selection.period === candidate.period)).toBe(true);
    }
    // The first-half leg never shares a candidate with a full-match leg.
    expect(candidates.some((c) => legIds(c).includes("fh-over"))).toBe(false);
  });

  it("filters by event id", () => {
    const batch = [
      matchTotal("OVER", "2.5", 2.2),
      matchTotal("UNDER", "2.5", 2.1),
      matchTotal("OVER", "1.5", 2.2, "book-a"),
      matchTotal("UNDER", "1.5", 2.1, "book-a"),
    ];
    batch[2]!.eventId = "event-2";
    batch[3]!.eventId = "event-2";

    const onlyOne = generateCandidates(batch, { eventId: "event-1" });
    expect(onlyOne.every((c) => c.eventId === "event-1")).toBe(true);
    const both = generateCandidates(batch);
    expect(new Set(both.map((c) => c.eventId))).toEqual(new Set(["event-1", "event-2"]));
  });

  it("does not pair incompatible market families", () => {
    const corners = priced(
      selection(MarketFamily.CORNERS, MarketType.STANDARD, "OVER", { line: "9.5" }),
      1.9,
      "book-a"
    );
    const cards = priced(
      selection(MarketFamily.CARDS, MarketType.STANDARD, "OVER", { line: "3.5" }),
      1.9,
      "book-a"
    );
    expect(generateCandidates([corners, cards])).toHaveLength(0);
  });

  it("pairs compatible cross-family markets", () => {
    const total = matchTotal("OVER", "2.5", 2.2);
    const team = teamTotal(Participant.HOME, "OVER", "1.5", 2.1);
    const candidates = generateCandidates([total, team]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.structureType).toBe("TEAM_TOTAL_MATCH_TOTAL");
  });

  it("excludes two legs on the same selection (different bookmakers)", () => {
    const a = matchTotal("OVER", "2.5", 2.2, "book-a");
    const b = matchTotal("OVER", "2.5", 2.0, "book-b");
    expect(generateCandidates([a, b])).toHaveLength(0);
  });

  it("grows candidate size from 2 to 3", () => {
    const batch = [
      matchTotal("OVER", "2.5", 2.2),
      matchTotal("UNDER", "2.5", 2.1),
      teamTotal(Participant.HOME, "OVER", "1.5", 2.1),
      teamTotal(Participant.AWAY, "OVER", "1.5", 2.1),
    ];
    const two = generateCandidates(batch, { maxLegs: 2 });
    expect(two.every((c) => c.legs.length === 2)).toBe(true);
    const three = generateCandidates(batch, { maxLegs: 3 });
    expect(three.some((c) => c.legs.length === 3)).toBe(true);
  });

  it("bounds generation with maxCandidates", () => {
    const batch = [
      matchTotal("OVER", "2.5", 2.2),
      matchTotal("UNDER", "2.5", 2.1),
      teamTotal(Participant.HOME, "OVER", "1.5", 2.1),
      teamTotal(Participant.AWAY, "OVER", "1.5", 2.1),
    ];
    expect(generateCandidates(batch, { maxCandidates: 3 })).toHaveLength(3);
  });
});

describe("classifyStructure", () => {
  it("labels the supported structures", () => {
    expect(
      classifyStructure([matchTotal("OVER", "2.5", 2.2), matchTotal("UNDER", "2.5", 2.1)])
    ).toBe("SAME_MARKET_COMPLEMENT");
    expect(
      classifyStructure([matchTotal("OVER", "2.5", 2.2), matchTotal("UNDER", "3.5", 2.1)])
    ).toBe("COMPLEMENTARY_TOTALS");
    const home = priced(
      selection(MarketFamily.ASIAN_HANDICAP, MarketType.HANDICAP, "HOME", { line: "-0.75" }),
      2.1,
      "book-a"
    );
    const away = priced(
      selection(MarketFamily.ASIAN_HANDICAP, MarketType.HANDICAP, "AWAY", { line: "0.75" }),
      2.1,
      "book-b"
    );
    expect(classifyStructure([home, away])).toBe("PROTECTED_HANDICAP");

    const results = [
      priced(selection(MarketFamily.MATCH_RESULT, MarketType.ONE_X_TWO, "HOME"), 3.5, "a"),
      priced(selection(MarketFamily.MATCH_RESULT, MarketType.ONE_X_TWO, "DRAW"), 3.4, "b"),
      priced(selection(MarketFamily.MATCH_RESULT, MarketType.ONE_X_TWO, "AWAY"), 3.6, "c"),
    ];
    expect(classifyStructure(results)).toBe("PARTITION");
  });
});

describe("pruneCandidate", () => {
  it("accepts a clean candidate", () => {
    const candidate = generateCandidates([
      matchTotal("OVER", "2.5", 2.2, "book-a"),
      matchTotal("UNDER", "2.5", 2.1, "book-b"),
    ])[0]!;
    expect(pruneCandidate(candidate)).toHaveLength(0);
  });

  it("rejects invalid odds, suspension, staleness and uncertain events", () => {
    const badOdds = generateCandidates([
      priced(
        selection(MarketFamily.MATCH_TOTAL, MarketType.STANDARD, "OVER", { line: "2.5" }),
        1.0,
        "a"
      ),
      matchTotal("UNDER", "2.5", 2.1, "b"),
    ])[0]!;
    expect(pruneCandidate(badOdds).map((v) => v.reason)).toContain("INVALID_ODDS");

    const suspended = generateCandidates([
      matchTotal("OVER", "2.5", 2.2, "a"),
      { ...matchTotal("UNDER", "2.5", 2.1, "b"), suspended: true },
    ])[0]!;
    expect(pruneCandidate(suspended).map((v) => v.reason)).toContain("SUSPENDED");

    const stale = generateCandidates([
      { ...matchTotal("OVER", "2.5", 2.2, "a"), observedAt: 0 },
      matchTotal("UNDER", "2.5", 2.1, "b"),
    ])[0]!;
    expect(pruneCandidate(stale, { maxAgeMs: 1000, now: 5000 }).map((v) => v.reason)).toContain(
      "STALE_ODDS"
    );

    const uncertain = generateCandidates([
      { ...matchTotal("OVER", "2.5", 2.2, "a"), eventConfidence: 0.5 },
      matchTotal("UNDER", "2.5", 2.1, "b"),
    ])[0]!;
    expect(pruneCandidate(uncertain).map((v) => v.reason)).toContain("EVENT_UNCERTAIN");
  });

  it("enforces the cross-book policy when requested", () => {
    const candidate = generateCandidates([
      matchTotal("OVER", "2.5", 2.2, "book-a"),
      matchTotal("UNDER", "2.5", 2.1, "book-a"),
    ])[0]!;
    expect(pruneCandidate(candidate, { allowSameBookmaker: true })).toHaveLength(0);
    expect(pruneCandidate(candidate, { allowSameBookmaker: false }).map((v) => v.reason)).toContain(
      "SAME_BOOKMAKER"
    );
  });

  it("applies the price prefilter only to standard complements", () => {
    const complement = generateCandidates([
      matchTotal("OVER", "2.5", 1.9, "a"),
      matchTotal("UNDER", "2.5", 1.95, "b"),
    ])[0]!;
    expect(pruneCandidate(complement).map((v) => v.reason)).toContain("PRICE_PREFILTER");

    const complex = generateCandidates([
      matchTotal("OVER", "1.0", 1.5, "a"),
      matchTotal("UNDER", "1.5", 2.4, "b"),
    ])[0]!;
    expect(pruneCandidate(complex).map((v) => v.reason)).not.toContain("PRICE_PREFILTER");
  });

  it("formats a verdict", () => {
    expect(formatPruneVerdict({ reason: "SUSPENDED", detail: "x", legIds: ["a"] })).toBe(
      "SUSPENDED: x | legs: a"
    );
  });
});

describe("isStandardComplement", () => {
  it("recognizes exact complements and rejects different lines", () => {
    expect(
      isStandardComplement([matchTotal("OVER", "2.5", 2.2), matchTotal("UNDER", "2.5", 2.1)])
    ).toBe(true);
    expect(
      isStandardComplement([matchTotal("OVER", "2.5", 2.2), matchTotal("UNDER", "3.5", 2.1)])
    ).toBe(false);
  });
});

describe("bestPricePerSelection", () => {
  it("keeps the best price per distinct selection", () => {
    const best = bestPricePerSelection([
      matchTotal("OVER", "2.5", 2.0, "book-a"),
      matchTotal("OVER", "2.5", 2.2, "book-b"),
      matchTotal("UNDER", "2.5", 2.1, "book-a"),
    ]);
    expect(best).toHaveLength(2);
    const over = best.find((entry) => entry.selection.outcome === "OVER");
    expect(over?.odds).toBe(2.2);
    expect(over?.bookmaker).toBe("book-b");
  });
});

describe("scanCandidates", () => {
  it("finds a known two-way arb", () => {
    const scans = scanCandidates([
      matchTotal("OVER", "2.5", 2.2, "book-a"),
      matchTotal("UNDER", "2.5", 2.1, "book-b"),
    ]);
    const arb = scans.find((scan) => scan.status === "ARB");
    expect(arb).toBeDefined();
    expect(arb?.plan?.isArb).toBe(true);
    expect(arb?.plan?.minReturn).toBeGreaterThan(100);
  });

  it("rejects a known false arb through the detector", () => {
    const scans = scanCandidates([
      matchTotal("OVER", "10.5", 2.0, "a"),
      matchTotal("UNDER", "13.5", 2.0, "b"),
    ]);
    const rejected = scans.find((scan) => scan.status === "REJECTED");
    expect(rejected).toBeDefined();
    expect(rejected?.coverage?.rejections.map((v) => v.reason)).toContain("NON_EXCLUSIVE");
  });

  it("returns NO_ARB for a covered but unprofitable structure", () => {
    const scans = scanCandidates([
      matchTotal("OVER", "1.0", 1.5, "a"),
      matchTotal("UNDER", "1.5", 2.4, "b"),
    ]);
    const noArb = scans.find((scan) => scan.status === "NO_ARB");
    expect(noArb).toBeDefined();
    expect(noArb?.plan?.isArb).toBe(false);
    expect(noArb?.coverage?.status).toBe("COVERED");
  });

  it("prunes before detection (suspended and price-prefiltered)", () => {
    const suspended = scanCandidates([
      matchTotal("OVER", "2.5", 2.2, "a"),
      { ...matchTotal("UNDER", "2.5", 2.1, "b"), suspended: true },
    ]);
    expect(suspended[0]?.status).toBe("PRUNED");
    expect(suspended[0]?.coverage).toBeNull();

    const prefiltered = scanCandidates([
      matchTotal("OVER", "2.5", 1.9, "a"),
      matchTotal("UNDER", "2.5", 1.95, "b"),
    ]);
    expect(prefiltered[0]?.status).toBe("PRUNED");
    expect(prefiltered[0]?.pruning.verdicts.map((v) => v.reason)).toContain("PRICE_PREFILTER");
  });
});
