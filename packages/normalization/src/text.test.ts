import { describe, expect, it } from "vitest";

import {
  collapsePunctuation,
  collapseWhitespace,
  normalizeCompetition,
  normalizeText,
  normalizeTeamName,
  stripDiacritics,
} from "./text";

describe("text normalization", () => {
  it("folds case and applies NFKC", () => {
    expect(normalizeText(" MANCHESTER City ")).toBe("manchester city");
    expect(normalizeText("\uff21FF")) // fullwidth A (NFKC → "A") + letters
      .toBe("aff");
    expect(normalizeText("\u2126")) // OHM SIGN → Ω (NFKC), then case-folded
      .toBe("ω");
  });

  it("removes combining marks (diacritics)", () => {
    expect(stripDiacritics("Fenerbahçe")).toBe("Fenerbahce");
    expect(stripDiacritics("München")).toBe("Munchen");
    expect(normalizeTeamName("Bayern München")).toBe("bayern munchen");
  });

  it("replaces punctuation with spaces", () => {
    expect(collapsePunctuation("A.C. Milan")).toBe("A C Milan");
    expect(normalizeText("Real Madrid C.F.")).toBe("real madrid c f");
  });

  it("collapses whitespace runs", () => {
    expect(collapseWhitespace("  Paris   Saint\u00a0Germain\t ")).toBe("Paris Saint Germain");
  });

  it("normalizes competitions like team names", () => {
    expect(normalizeCompetition("England - Premier League")).toBe("england premier league");
  });
});
