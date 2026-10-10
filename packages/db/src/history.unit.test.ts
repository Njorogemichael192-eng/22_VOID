import { describe, expect, it } from "vitest";

import {
  computeOpportunityKey,
  legKeyFromSelectionIds,
  percentileNearestRank,
} from "./history.js";

describe("opportunity episode identity (Phase 15)", () => {
  it("is deterministic for the same legs regardless of order or duplicates", () => {
    const base = { eventCanonicalId: "evt-1", structureType: "SAME_MARKET_COMPLEMENT", selectionIds: ["sel-z", "sel-a"] };
    const key = computeOpportunityKey(base);
    expect(key).toBe("episode:evt-1:SAME_MARKET_COMPLEMENT:sel-a+sel-z");
    expect(computeOpportunityKey({ ...base, selectionIds: ["sel-a", "sel-z"] })).toBe(key);
    expect(computeOpportunityKey({ ...base, selectionIds: ["sel-a", "sel-z", "sel-a"] })).toBe(key);
  });

  it("differs when the structure or leg set changes", () => {
    const base = { eventCanonicalId: "evt-1", structureType: "SAME_MARKET_COMPLEMENT", selectionIds: ["sel-a", "sel-b"] };
    expect(computeOpportunityKey({ ...base, structureType: "DIFFERENT_BOOKMAKER_MULTIWAY" })).not.toBe(
      computeOpportunityKey(base),
    );
    expect(computeOpportunityKey({ ...base, selectionIds: ["sel-a", "sel-c"] })).not.toBe(
      computeOpportunityKey(base),
    );
  });

  it("rejects zero leg sets and de-duplicates the leg key", () => {
    expect(() => computeOpportunityKey({ eventCanonicalId: "evt-1", structureType: "X", selectionIds: [] })).toThrow();
    expect(legKeyFromSelectionIds(["b", "a", "b"])).toBe("a,b");
  });
});

describe("source reliability percentiles", () => {
  it("uses nearest-rank on the ascending series", () => {
    const sorted = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentileNearestRank(sorted, 0.5)).toBe(50);
    expect(percentileNearestRank(sorted, 0.95)).toBe(100);
    expect(percentileNearestRank(sorted, 1)).toBe(100);
  });

  it("clamps small samples and flags the empty set", () => {
    expect(percentileNearestRank([42], 0.95)).toBe(42);
    expect(Number.isNaN(percentileNearestRank([], 0.5))).toBe(true);
  });
});