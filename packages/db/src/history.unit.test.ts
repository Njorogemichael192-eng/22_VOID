import { describe, expect, it } from "vitest";

import {
  computeOpportunityKey,
  legKeyFromSelectionIds,
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