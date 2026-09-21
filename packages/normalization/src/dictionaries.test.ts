import { describe, expect, it } from "vitest";

import {
  COMPETITION_ALIASES,
  CompetitionDictionary,
  createDefaultCompetitionDictionary,
  createDefaultTeamDictionary,
  TEAM_ALIASES,
  TeamDictionary,
} from "./dictionaries";

describe("TeamDictionary", () => {
  it("seeds the built-in premier-league alias set", () => {
    const dict = createDefaultTeamDictionary();
    expect(dict.resolve("Man City")).toEqual({ canonicalName: "Manchester City", kind: "alias" });
    expect(dict.resolve("AC Milan")).toEqual({ canonicalName: "AC Milan", kind: "direct" });
    expect(dict.resolve("Milan")).toEqual({ canonicalName: "AC Milan", kind: "alias" });
  });

  it("normalizes aliases before lookup", () => {
    const dict = createDefaultTeamDictionary();
    expect(dict.resolve("MAN CITY  ")).toEqual({ canonicalName: "Manchester City", kind: "alias" });
    expect(dict.resolve("Bayern München")).toEqual({
      canonicalName: "Bayern Munich",
      kind: "alias",
    });
    expect(dict.resolve("A.C. Milan")).toEqual({ canonicalName: "AC Milan", kind: "alias" });
    expect(dict.resolve("PSG ")).toEqual({ canonicalName: "Paris Saint-Germain", kind: "alias" });
  });

  it("resolves unknown names to themselves as 'new'", () => {
    const dict = new TeamDictionary();
    expect(dict.resolve("AC Omonia Nicosia")).toEqual({
      canonicalName: "AC Omonia Nicosia",
      kind: "new",
    });
  });

  it("extends at runtime", () => {
    const dict = new TeamDictionary();
    dict.add("AC Omonia Nicosia", ["Omonia"]);
    expect(dict.resolve("Omonia")).toEqual({ canonicalName: "AC Omonia Nicosia", kind: "alias" });
  });

  it("add supports the first-club-field style used in comparisons", () => {
    const dict = createDefaultTeamDictionary();
    expect(dict.resolve("Benfica Lisbon")).toEqual({ canonicalName: "Benfica", kind: "alias" });
    expect(TEAM_ALIASES.some(([canonical]) => canonical === "Benfica")).toBe(true);
  });
});

describe("CompetitionDictionary", () => {
  it("resolves competition aliases", () => {
    const dict = createDefaultCompetitionDictionary();
    expect(dict.resolve("EPL")).toEqual({
      canonicalName: "England - Premier League",
      kind: "alias",
    });
    expect(dict.resolve("England - Premier League")).toEqual({
      canonicalName: "England - Premier League",
      kind: "direct",
    });
    expect(dict.resolve("La Liga")).toEqual({ canonicalName: "Spain - La Liga", kind: "alias" });
  });

  it("resolves unknown competitions to themselves", () => {
    const dict = new CompetitionDictionary();
    expect(dict.resolve("Cypriot First Division")).toEqual({
      canonicalName: "Cypriot First Division",
      kind: "new",
    });
  });
});

describe("seed data sanity", () => {
  it("maps names to the same canonical competition as the raw fixtures", () => {
    const dict = createDefaultCompetitionDictionary();
    expect(dict.resolve("England - Premier League").canonicalName).toBe("England - Premier League");
    expect(COMPETITION_ALIASES.length).toBeGreaterThanOrEqual(5);
  });
});
