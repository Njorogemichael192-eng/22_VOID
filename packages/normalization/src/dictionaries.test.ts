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

  it("folds the live provider spellings of the same clubs", () => {
    const dict = createDefaultTeamDictionary();
    const pairs: readonly (readonly [string, string])[] = [
      ["Arsenal", "Arsenal"],
      ["Leeds United", "Leeds United FC"],
      ["Bournemouth", "AFC Bournemouth"],
      ["Everton", "Everton FC"],
      ["Manchester United", "Manchester United FC"],
      ["Manchester City", "Manchester City FC"],
      ["Nottingham Forest", "Nottingham Forest FC"],
      ["Sunderland", "Sunderland AFC"],
      ["Brighton and Hove Albion", "Brighton & Hove Albion FC"],
      ["Ipswich Town", "Ipswich Town FC"],
      ["Fulham", "Fulham FC"],
      ["Aston Villa", "Aston Villa FC"],
      ["Brentford", "Brentford FC"],
      ["Tottenham Hotspur", "Tottenham Hotspur FC"],
      ["Hull City", "Hull City AFC"],
      ["Crystal Palace", "Crystal Palace FC"],
      ["Coventry City", "Coventry City FC"],
      ["Newcastle United", "Newcastle United FC"],
    ];
    for (const [oddsApi, parlayApi] of pairs) {
      const a = dict.resolve(oddsApi);
      const b = dict.resolve(parlayApi);
      expect(a.kind).toBe("direct");
      expect(b.canonicalName).toBe(a.canonicalName);
    }
  });

  it("leaves provider sort-variant labels such as '(Corners)' unrecognized", () => {
    const dict = createDefaultTeamDictionary();
    expect(dict.resolve("Chelsea (Corners)")).toEqual({
      canonicalName: "Chelsea (Corners)",
      kind: "new",
    });
    expect(dict.resolve("Bournemouth (Corners)")).toEqual({
      canonicalName: "Bournemouth (Corners)",
      kind: "new",
    });
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
