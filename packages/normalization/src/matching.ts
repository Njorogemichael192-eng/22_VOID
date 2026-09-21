import type { CompetitionDictionary, TeamDictionary } from "./dictionaries";
import { normalizeCompetition } from "./text";

/**
 * Event match confidence (Phase 4, §"Event confidence").
 *
 * Two provider events are compared via weighted signals. The exact weights are
 * configurable but the rule is absolute: **uncertain matches are never silently
 * merged**. Below the confirm threshold an assessment is either "uncertain"
 * (needs a human/supervisor decision) or "no match".
 */

export interface MatchPolicy {
  /** Default: 2 hours — kickoff times from different feeds rarely agree to the second. */
  startTimeToleranceMs?: number;
  /** Score at/above which a match is confirmed without review (default 0.8). */
  confirmThreshold?: number;
  /** Score at/above which a near-match is flagged uncertain instead of no-match. */
  uncertaintyFloor?: number;
  /** Allow home/away to be swapped when computing the team signal. */
  allowSwap?: boolean;
}

export interface MatchSignals {
  sourceId: boolean;
  teams: boolean;
  reverseTeams: boolean;
  startTime: boolean;
  competition: boolean;
}

export interface MatchAssessment {
  score: number;
  signals: MatchSignals;
  reasons: string[];
}

export interface NormalizedEventRef {
  provider: string;
  sourceEventId: string;
  homeTeam: string;
  awayTeam: string;
  competition?: string;
  startTime: string;
}

const DEFAULT_POLICY: Required<MatchPolicy> = {
  startTimeToleranceMs: 2 * 60 * 60 * 1000,
  confirmThreshold: 0.8,
  uncertaintyFloor: 0.5,
  allowSwap: false,
};

export function normalizeMatchPolicy(policy?: MatchPolicy): Required<MatchPolicy> {
  return { ...DEFAULT_POLICY, ...policy };
}

/**
 * Score how likely two events represent the same match.
 *
 * Signals: same provider event id (+1.0, immediate confirm), exact canonical
 * teams (+0.5), start time within tolerance (+0.3), competition equality
 * (+0.2). A home/away swap is scored but flagged; with `allowSwap` off it can
 * never reach the confidence floor on its own.
 */
export function computeMatchConfidence(
  a: NormalizedEventRef,
  b: NormalizedEventRef,
  teamDictionary: TeamDictionary,
  competitionDictionary: CompetitionDictionary,
  policy?: MatchPolicy
): MatchAssessment {
  const resolved = normalizeMatchPolicy(policy);
  const reasons: string[] = [];

  if (a.provider === b.provider && a.sourceEventId === b.sourceEventId) {
    return {
      score: 1.0,
      signals: {
        sourceId: true,
        teams: true,
        reverseTeams: false,
        startTime: true,
        competition: true,
      },
      reasons: ["same provider event id"],
    };
  }

  const homeA = teamDictionary.resolve(a.homeTeam);
  const awayA = teamDictionary.resolve(a.awayTeam);
  const homeB = teamDictionary.resolve(b.homeTeam);
  const awayB = teamDictionary.resolve(b.awayTeam);

  const teamsEqual =
    homeA.canonicalName.toLocaleLowerCase("und") === homeB.canonicalName.toLocaleLowerCase("und") &&
    awayA.canonicalName.toLocaleLowerCase("und") === awayB.canonicalName.toLocaleLowerCase("und");
  const reversed =
    resolved.allowSwap &&
    homeA.canonicalName.toLocaleLowerCase("und") === awayB.canonicalName.toLocaleLowerCase("und") &&
    awayA.canonicalName.toLocaleLowerCase("und") === homeB.canonicalName.toLocaleLowerCase("und");

  let score = 0;
  const signals: MatchSignals = {
    sourceId: false,
    teams: false,
    reverseTeams: false,
    startTime: false,
    competition: false,
  };

  if (teamsEqual || reversed) {
    score += 0.5;
    if (reversed) {
      signals.reverseTeams = true;
      reasons.push("home/away swapped");
    } else {
      signals.teams = true;
    }
  } else {
    reasons.push("teams do not match");
  }

  const startDelta = Math.abs(Date.parse(a.startTime) - Date.parse(b.startTime));
  if (Number.isFinite(startDelta) && startDelta <= resolved.startTimeToleranceMs) {
    score += 0.3;
    signals.startTime = true;
  } else {
    reasons.push("start time outside tolerance");
  }

  if (a.competition !== undefined && b.competition !== undefined) {
    const compA = competitionDictionary.resolve(a.competition);
    const compB = competitionDictionary.resolve(b.competition);
    const compFoldedA = normalizeCompetition(compA.canonicalName);
    const compFoldedB = normalizeCompetition(compB.canonicalName);
    if (compFoldedA === compFoldedB) {
      score += 0.2;
      signals.competition = true;
    } else {
      score -= 0.2;
      reasons.push("competition mismatch");
    }
  } else if (a.competition === undefined || b.competition === undefined) {
    reasons.push("competition missing on one side");
  }

  return { score: round3(score), signals, reasons };
}

/**
 * Determine what to do with an assessment under the policy.
 *
 * A merge is only ever proposed for events whose canonical teams agree: no
 * teams signal ⇒ "none" (safe to create a separate event). With a teams
 * signal, anything below the confirm threshold is "uncertain" — the spec's
 * "uncertain matches are never silently merged" rule.
 */
export function classifyMatch(
  assessment: MatchAssessment,
  policy?: MatchPolicy
): "confirmed" | "uncertain" | "none" {
  const resolved = normalizeMatchPolicy(policy);
  if (assessment.score >= resolved.confirmThreshold) return "confirmed";
  if (assessment.signals.teams || assessment.signals.reverseTeams) return "uncertain";
  return "none";
}

/** Convenience one-shot: does event A match event B? */
export function eventsMatch(
  a: NormalizedEventRef,
  b: NormalizedEventRef,
  teamDictionary: TeamDictionary,
  competitionDictionary: CompetitionDictionary,
  policy?: MatchPolicy
): { matched: boolean; uncertain: boolean; assessment: MatchAssessment } {
  const assessment = computeMatchConfidence(a, b, teamDictionary, competitionDictionary, policy);
  const kind = classifyMatch(assessment, policy);
  return { matched: kind === "confirmed", uncertain: kind === "uncertain", assessment };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
