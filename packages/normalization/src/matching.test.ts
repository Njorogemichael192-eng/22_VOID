import { describe, expect, it } from "vitest";

import { createDefaultCompetitionDictionary, createDefaultTeamDictionary } from "./dictionaries";
import { classifyMatch, computeMatchConfidence, eventsMatch } from "./matching";
import type { MatchAssessment, MatchPolicy, NormalizedEventRef } from "./matching";

const teams = createDefaultTeamDictionary();
const competitions = createDefaultCompetitionDictionary();

type RefOverrides = {
  provider?: string | undefined;
  sourceEventId?: string | undefined;
  homeTeam?: string | undefined;
  awayTeam?: string | undefined;
  competition?: string | undefined;
  startTime?: string | undefined;
};

/** Builds a distinct event reference; an explicit `undefined` omits the field. */
function ref(overrides: RefOverrides = {}, variant = "a"): NormalizedEventRef {
  const out = {
    provider: "odds-api",
    sourceEventId: `oddsepl001-${variant}`,
    homeTeam: "Manchester City",
    awayTeam: "Arsenal",
    competition: "England - Premier League",
    startTime: "2026-11-21T19:00:00.000Z",
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete (out as Record<string, string | undefined>)[key];
    } else {
      (out as Record<string, string>)[key] = value as string;
    }
  }
  return out;
}

describe("computeMatchConfidence", () => {
  it("confirms instantly on the same provider event id", () => {
    const assessment = computeMatchConfidence(ref({}, "a"), ref({}, "a"), teams, competitions);
    expect(assessment.score).toBe(1);
    expect(assessment.signals.sourceId).toBe(true);
    expect(classifyMatch(assessment)).toBe("confirmed");
  });

  it("confirms a cross-provider match on teams + start + competition", () => {
    const b = ref({ provider: "parlay-api", sourceEventId: "parlayepl001" });
    const assessment = computeMatchConfidence(ref(), b, teams, competitions);
    expect(assessment.score).toBe(1);
    expect(classifyMatch(assessment)).toBe("confirmed");
    expect(assessment.reasons).toEqual([]);
  });

  it("confirms when teams and start agree but competition is missing", () => {
    const b = ref({ provider: "parlay-api", sourceEventId: "p1", competition: undefined });
    const assessment = computeMatchConfidence(ref(), b, teams, competitions);
    expect(assessment.score).toBe(0.8);
    expect(classifyMatch(assessment)).toBe("confirmed");
  });

  it("keeps teams + start + competition mismatch as uncertain (never merges on a conflict)", () => {
    const b = ref({
      provider: "parlay-api",
      sourceEventId: "p1",
      competition: "England - FA Cup",
    });
    const assessment = computeMatchConfidence(ref(), b, teams, competitions);
    expect(assessment.score).toBe(0.6);
    expect(classifyMatch(assessment)).toBe("uncertain");
    expect(assessment.reasons).toContain("competition mismatch");
  });

  it("teams-only (0.5) is uncertain, never merged", () => {
    const b = ref({
      provider: "parlay-api",
      sourceEventId: "p1",
      competition: undefined,
      startTime: "2026-11-22T19:00:00.000Z",
    });
    const assessment = computeMatchConfidence(ref(), b, teams, competitions);
    expect(assessment.score).toBe(0.5);
    expect(classifyMatch(assessment)).toBe("uncertain");
  });

  it("competition alone (or with a matching start) is not a teams signal → no match", () => {
    const b = ref({
      provider: "parlay-api",
      sourceEventId: "p1",
      homeTeam: "Chelsea",
      awayTeam: "Liverpool",
      competition: "England - FA Cup",
      startTime: "2026-11-21T19:00:00.000Z",
    });
    const assessment = computeMatchConfidence(ref(), b, teams, competitions);
    expect(assessment.score).toBe(0.1);
    expect(assessment.signals.teams).toBe(false);
    expect(classifyMatch(assessment)).toBe("none");
  });

  it("start time outside tolerance reduces confidence to uncertain", () => {
    const b = ref({
      provider: "parlay-api",
      sourceEventId: "p1",
      competition: undefined,
      startTime: "2026-11-24T19:00:00.000Z",
    });
    const assessment = computeMatchConfidence(ref(), b, teams, competitions);
    expect(assessment.score).toBe(0.5);
    expect(assessment.reasons).toContain("start time outside tolerance");
  });

  it("rejects a home/away swap unless allowSwap, and flags it when allowed", () => {
    const swapped = ref({ homeTeam: "Arsenal", awayTeam: "Manchester City" }, "b");
    const noSwap: MatchPolicy = { allowSwap: false };
    const noSwapAssessment = computeMatchConfidence(ref(), swapped, teams, competitions, noSwap);
    expect(noSwapAssessment.signals.teams).toBe(false);
    expect(noSwapAssessment.signals.reverseTeams).toBe(false);
    expect(classifyMatch(noSwapAssessment, noSwap)).toBe("none");

    const yesSwap: MatchPolicy = { allowSwap: true };
    const assessment = computeMatchConfidence(ref(), swapped, teams, competitions, yesSwap);
    expect(assessment.score).toBe(1);
    expect(assessment.signals.reverseTeams).toBe(true);
    expect(assessment.reasons).toContain("home/away swapped");
  });

  it("resolves aliases through the dictionaries (Man City == Manchester City)", () => {
    const b = ref({ homeTeam: "Man City", provider: "parlay-api", sourceEventId: "p1" });
    const assessment = computeMatchConfidence(ref(), b, teams, competitions);
    expect(assessment.signals.teams).toBe(true);
  });
});

describe("eventsMatch", () => {
  it("classifies confirmed and uncertain matches without merging", () => {
    const confirmed = eventsMatch(
      ref(),
      ref({ provider: "p2", sourceEventId: "s2" }),
      teams,
      competitions
    );
    expect(confirmed.matched).toBe(true);
    expect(confirmed.uncertain).toBe(false);

    const near = eventsMatch(
      ref(),
      ref({
        provider: "p2",
        sourceEventId: "s2",
        competition: undefined,
        startTime: "2026-11-22T10:00:00.000Z",
      }),
      teams,
      competitions
    );
    expect(near.matched).toBe(false);
    expect(near.uncertain).toBe(true);
  });

  it("keeps assessment scoring stable under mutation of inputs", () => {
    const a = ref();
    const b = ref({ provider: "p2", sourceEventId: "s2" });
    const one: MatchAssessment = computeMatchConfidence(a, b, teams, competitions);
    expect(one.score).toBe(1);
    expect(ref().homeTeam).toBe("Manchester City");
  });
});
