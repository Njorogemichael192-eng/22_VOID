import { describe, expect, it } from "vitest";

import type { CanonicalEvent } from "@22void/domain";

import { TeamDictionary } from "./dictionaries";
import { EventNormalizer } from "./registry";
import type { IncomingEventInput } from "./registry";
import { SourceIdIndex } from "./source-ids";

// Same match as the Phase 3 wire fixtures represent, kept inline so the
// normalizer test is self-contained.
const MAN_CITY_HOME: IncomingEventInput = {
  provider: "odds-api",
  sourceEventId: "oddsepl001",
  homeTeam: "Manchester City",
  awayTeam: "Arsenal",
  competition: "England - Premier League",
  startTime: "2026-11-21T19:00:00.000Z",
};

describe("EventNormalizer — creation", () => {
  it("creates a canonical event and canonicalizes names + competition", () => {
    const normalizer = new EventNormalizer();
    const result = normalizer.register({ ...MAN_CITY_HOME });
    expect(result.action).toBe("created");
    expect(result.canonicalEventId).toBe("odds-api:oddsepl001");
    expect(result.canonicalEvent).toMatchObject({
      canonicalEventId: "odds-api:oddsepl001",
      sport: "football",
      homeTeam: "Manchester City",
      awayTeam: "Arsenal",
      competition: "England - Premier League",
    });
    expect(normalizer.events()).toHaveLength(1);
    expect(normalizer.sourceIndex().has("odds-api", "oddsepl001")).toBe(true);
  });
});

describe("EventNormalizer — duplicates", () => {
  it("dedupes re-registration of the same provider event", () => {
    const normalizer = new EventNormalizer();
    normalizer.register({ ...MAN_CITY_HOME });
    const again = normalizer.register({ ...MAN_CITY_HOME });
    expect(again.action).toBe("merged");
    expect(again.confidence).toBe(1);
    expect(again.reasons).toContain("duplicate sourceEventId");
    expect(normalizer.events()).toHaveLength(1);
    expect(normalizer.events()[0]!.sourceEventIds).toHaveLength(1);
  });
});

describe("EventNormalizer — cross-provider acceptance (same event, one canonical)", () => {
  it("merges the same match from two providers into one canonical event", () => {
    const normalizer = new EventNormalizer();
    normalizer.register({ ...MAN_CITY_HOME });
    normalizer.register({
      provider: "odds-api",
      sourceEventId: "oddsepl002",
      homeTeam: "Chelsea",
      awayTeam: "Liverpool",
      competition: "England - Premier League",
      startTime: "2026-11-21T19:30:00.000Z",
    });
    const merged = normalizer.register({
      provider: "parlay-api",
      sourceEventId: "parlayepl001",
      homeTeam: "Manchester City",
      awayTeam: "Arsenal",
      competition: "England - Premier League",
      startTime: "2026-11-21T19:00:00.000Z",
    });

    expect(merged.action).toBe("merged");
    expect(merged.canonicalEventId).toBe("odds-api:oddsepl001");
    expect(merged.confidence).toBe(1);

    const events = normalizer.events();
    expect(events).toHaveLength(2);
    const [onMancity] = events;
    expect(onMancity!.sourceEventIds).toContainEqual({
      provider: "odds-api",
      sourceEventId: "oddsepl001",
    });
    expect(onMancity!.sourceEventIds).toContainEqual({
      provider: "parlay-api",
      sourceEventId: "parlayepl001",
    });
    expect(normalizer.sourceIndex().lookup("parlay-api", "parlayepl001")).toBe(
      "odds-api:oddsepl001"
    );
  });

  it("merges via alias dictionary + competition alias + start-time tolerance", () => {
    const normalizer = new EventNormalizer();
    normalizer.register({ ...MAN_CITY_HOME });
    const alias = normalizer.register({
      provider: "parlay-api",
      sourceEventId: "parlayepl002",
      homeTeam: "Man City", // alias → Manchester City
      awayTeam: "Arsenal",
      competition: "EPL", // alias → England - Premier League
      startTime: "2026-11-21T19:00:30.000Z", // within 2h tolerance
    });
    expect(alias.action).toBe("merged");
    expect(alias.canonicalEventId).toBe("odds-api:oddsepl001");
    expect(alias.canonicalEvent!.homeTeam).toBe("Manchester City");
  });
});

describe("EventNormalizer — uncertain (never silently merges)", () => {
  it("holds teams-only near-matches as uncertain, not merged", () => {
    const normalizer = new EventNormalizer();
    normalizer.register({ ...MAN_CITY_HOME });
    const near = normalizer.register({
      provider: "parlay-api",
      sourceEventId: "parlayepl009",
      homeTeam: "Manchester City",
      awayTeam: "Arsenal",
      competition: "England - FA Cup", // mismatch → -0.2
      startTime: "2026-11-22T18:00:00.000Z", // outside tolerance
    });
    expect(near.action).toBe("uncertain");
    expect(near.canonicalEvent).toBeUndefined();
    expect(normalizer.events()).toHaveLength(1);
  });

  it("keeps competition-mismatch near-matches uncertain even when times align", () => {
    const normalizer = new EventNormalizer();
    normalizer.register({ ...MAN_CITY_HOME });
    const near = normalizer.register({
      provider: "parlay-api",
      sourceEventId: "parlayepl010",
      homeTeam: "Manchester City",
      awayTeam: "Arsenal",
      competition: "England - FA Cup",
      startTime: "2026-11-21T19:00:00.000Z",
    });
    expect(near.action).toBe("uncertain");
    expect(near.reasons.join(" ")).toContain("competition mismatch");
    expect(normalizer.events()).toHaveLength(1);
  });

  it("flags events whose teams collapse to one name as uncertain", () => {
    const normalizer = new EventNormalizer();
    const result = normalizer.register({
      provider: "parlay-api",
      sourceEventId: "parlayepl011",
      homeTeam: "AC Milan",
      awayTeam: "Milan", // alias → AC Milan
      competition: "Italy - Serie A",
      startTime: "2026-11-21T19:00:00.000Z",
    });
    expect(result.action).toBe("uncertain");
    expect(result.reasons.join(" ")).toContain("same name");
  });

  it("creates a new canonical event when nothing matches", () => {
    const normalizer = new EventNormalizer();
    normalizer.register({ ...MAN_CITY_HOME });
    const other = normalizer.register({
      provider: "parlay-api",
      sourceEventId: "parlayepl012",
      homeTeam: "Chelsea",
      awayTeam: "Liverpool",
      competition: "England - Premier League",
      startTime: "2026-11-21T19:30:00.000Z",
    });
    expect(other.action).toBe("created");
    expect(other.canonicalEventId).toBe("parlay-api:parlayepl012");
    expect(normalizer.events()).toHaveLength(2);
  });
});

describe("EventNormalizer — resume from storage", () => {
  it("seeds events + source bindings and resolves a new duplicate ref to the existing event", () => {
    const seedEvent: CanonicalEvent = {
      canonicalEventId: "odds-api:oddsepl001",
      sport: "football",
      competition: "England - Premier League",
      homeTeam: "Manchester City",
      awayTeam: "Arsenal",
      startTime: "2026-11-21T19:00:00.000Z",
      status: "SCHEDULED",
      sourceEventIds: [{ provider: "odds-api", sourceEventId: "oddsepl001" }],
    };
    const index = new SourceIdIndex();
    index.register("odds-api", "oddsepl001", "odds-api:oddsepl001");

    const normalizer = new EventNormalizer({ seedEvents: [seedEvent], seedSourceIndex: index });
    expect(normalizer.events()).toHaveLength(1);

    const merged = normalizer.register({
      provider: "parlay-api",
      sourceEventId: "parlayepl001",
      homeTeam: "Manchester City",
      awayTeam: "Arsenal",
      competition: "England - Premier League",
      startTime: "2026-11-21T19:00:00.000Z",
    });
    expect(merged.action).toBe("merged");
    expect(merged.canonicalEventId).toBe("odds-api:oddsepl001");
    expect(merged.canonicalEvent!.sourceEventIds).toContainEqual({
      provider: "parlay-api",
      sourceEventId: "parlayepl001",
    });
  });
});

describe("EventNormalizer — custom dictionaries", () => {
  it("respects injected dictionary configuration", () => {
    const teams = new TeamDictionary([["Real Salt Lake", ["RSL"]]]);
    const normalizer = new EventNormalizer({ teamDictionary: teams });
    const created = normalizer.register({
      provider: "parlay-api",
      sourceEventId: "p001",
      homeTeam: "Real Salt Lake",
      awayTeam: "LA Galaxy",
      competition: "USA - MLS",
      startTime: "2026-11-21T19:00:00.000Z",
    });
    expect(created.canonicalEvent!.homeTeam).toBe("Real Salt Lake");
    const merged = normalizer.register({
      provider: "parlay-api",
      sourceEventId: "p002",
      homeTeam: "RSL", // alias → Real Salt Lake
      awayTeam: "LA Galaxy",
      competition: "USA - MLS",
      startTime: "2026-11-21T19:00:00.000Z",
    });
    expect(merged.action).toBe("merged");
    expect(merged.canonicalEventId).toBe("parlay-api:p001");
  });
});
