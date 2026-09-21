import { describe, expect, it } from "vitest";

import {
  computeMatchConfidence,
  createDefaultCompetitionDictionary,
  createDefaultTeamDictionary,
  EventNormalizer,
  eventsMatch,
  formatCanonicalLine,
  MarketNormalizer,
  marketIdentityKey,
  normalizeTeamName,
  SourceIdIndex,
  toStructure,
} from "./index";

describe("@22void/normalization export surface", () => {
  it("exposes the Phase 4–5 normalization modules", () => {
    expect(typeof normalizeTeamName).toBe("function");
    expect(typeof computeMatchConfidence).toBe("function");
    expect(typeof eventsMatch).toBe("function");
    expect(typeof EventNormalizer).toBe("function");
    expect(typeof SourceIdIndex).toBe("function");
    expect(typeof createDefaultTeamDictionary).toBe("function");
    expect(typeof createDefaultCompetitionDictionary).toBe("function");
    expect(typeof MarketNormalizer).toBe("function");
    expect(typeof formatCanonicalLine).toBe("function");
    expect(typeof marketIdentityKey).toBe("function");
    expect(typeof toStructure).toBe("function");
  });
});
