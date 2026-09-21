import { MarketFamily, type MarketType, Participant, SelectionOutcome } from "@22void/domain";

/**
 * Provider outcome-label → canonical outcome mapping (Phase 3).
 *
 * Adapters normalize provider market keys and outcome labels into the domain
 * taxonomy. When a provider label cannot be resolved to a canonical outcome we
 * MUST NOT guess: the caller records a skipped outcome instead (Rule 4).
 */

export interface OutcomeContext {
  homeTeam: string;
  awayTeam: string;
}

function normalizeLabel(label: string): string {
  return label.replace(/\s+/g, " ").trim().toLowerCase();
}

function matchesTeam(label: string, team: string): boolean {
  return normalizeLabel(label) === normalizeLabel(team);
}

/** Map a match-result style label (1X2) to HOME / DRAW / AWAY. */
export function mapResultOutcome(label: string, ctx: OutcomeContext): string | null {
  const normalized = normalizeLabel(label);
  if (matchesTeam(label, ctx.homeTeam)) return SelectionOutcome.HOME;
  if (matchesTeam(label, ctx.awayTeam)) return SelectionOutcome.AWAY;
  if (normalized === "draw" || normalized === "tie" || normalized === "x") {
    return SelectionOutcome.DRAW;
  }
  if (normalized === "п1" || normalized === "p1") return SelectionOutcome.HOME;
  if (normalized === "п2" || normalized === "p2") return SelectionOutcome.AWAY;
  return null;
}

/** Map an Over/Under label to OVER / UNDER. */
export function mapOverUnderOutcome(label: string): string | null {
  const normalized = normalizeLabel(label);
  if (normalized === "over" || normalized.startsWith("over")) return SelectionOutcome.OVER;
  if (normalized === "under" || normalized.startsWith("under")) return SelectionOutcome.UNDER;
  if (normalized === "o" || normalized === "u") {
    return normalized === "o" ? SelectionOutcome.OVER : SelectionOutcome.UNDER;
  }
  return null;
}

/** Map a BTTS Yes/No label. */
export function mapBttsOutcome(label: string): string | null {
  const normalized = normalizeLabel(label);
  if (normalized === "yes" || normalized === "y") return SelectionOutcome.BTTS_YES;
  if (normalized === "no" || normalized === "n") return SelectionOutcome.BTTS_NO;
  return null;
}

/** Map a double-chance label (1X / X2 / 12). */
export function mapDoubleChanceOutcome(label: string): string | null {
  const normalized = normalizeLabel(label);
  if (
    normalized === "1x" ||
    normalized === "x1" ||
    normalized === "home or draw" ||
    normalized === "home/draw"
  ) {
    return SelectionOutcome.HOME_OR_DRAW;
  }
  if (
    normalized === "x2" ||
    normalized === "2x" ||
    normalized === "draw or away" ||
    normalized === "draw/away"
  ) {
    return SelectionOutcome.AWAY_OR_DRAW;
  }
  if (normalized === "12" || normalized === "home or away" || normalized === "home/away") {
    return SelectionOutcome.HOME_OR_AWAY;
  }
  return null;
}

const SCORELINE_REGEX = /(\d{1,3})\D{0,2}(\d{1,3})/;

/** Map an exact-score label ("2-1", "2:1", "Correct Score 2-1") to "2-1". */
export function mapExactScoreOutcome(label: string): string | null {
  const normalized = normalizeLabel(label);
  const match = normalized.match(SCORELINE_REGEX);
  if (!match) return null;
  return `${match[1]}-${match[2]}`;
}

/** Map an Asian-handicap style side label (home/away selected side). */
export function mapHandicapParticipantOutcome(label: string, ctx: OutcomeContext): string | null {
  if (matchesTeam(label, ctx.homeTeam)) return SelectionOutcome.HOME;
  if (matchesTeam(label, ctx.awayTeam)) return SelectionOutcome.AWAY;
  return null;
}

/**
 * Route a label to the canonical outcome for a resolved market spec.
 * Returns null when the label cannot be resolved canonically.
 */
export function mapOutcomeFor(
  family: MarketFamily,
  marketType: MarketType,
  label: string,
  ctx: OutcomeContext
): string | null {
  switch (family) {
    case MarketFamily.MATCH_RESULT:
      return mapResultOutcome(label, ctx);
    case MarketFamily.MATCH_TOTAL:
    case MarketFamily.TEAM_TOTAL:
    case MarketFamily.CORNERS:
    case MarketFamily.CARDS:
    case MarketFamily.TEAM_ASIAN_TOTAL:
    case MarketFamily.ASIAN_TOTAL:
      return mapOverUnderOutcome(label);
    case MarketFamily.BTTS:
      return mapBttsOutcome(label);
    case MarketFamily.DOUBLE_CHANCE:
      return mapDoubleChanceOutcome(label);
    case MarketFamily.EXACT_SCORE:
      return mapExactScoreOutcome(label);
    case MarketFamily.ASIAN_HANDICAP:
      return mapHandicapParticipantOutcome(label, ctx);
    default:
      return null;
  }
}

/** Detect the participant for a team-total outcome label against the fixture. */
export function detectParticipant(label: string, ctx: OutcomeContext): Participant | null {
  if (matchesTeam(label, ctx.homeTeam)) return Participant.HOME;
  if (matchesTeam(label, ctx.awayTeam)) return Participant.AWAY;
  return null;
}
