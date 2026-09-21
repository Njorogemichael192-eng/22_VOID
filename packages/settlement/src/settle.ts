/**
 * Core settlement evaluator (§9–§16, Rule 3).
 *
 * Evaluates a canonical selection against a final match state and returns a
 * SettlementState built from lower-level component results. Quarter Asian
 * lines are split into component lines (see line.ts) and the components are
 * combined with the domain `settlementResultFromComponents` (§9). Anything that
 * cannot settle deterministically returns `kind: "unknown"` with a reason —
 * never a guessed result.
 */

import {
  ComponentResult,
  EventStatus,
  MarketFamily,
  Participant,
  Period,
  settlementResultFromComponents,
} from "@22void/domain";
import type { MarketType, SettlementState } from "@22void/domain";

import { parseCanonicalLine, splitAsianLine } from "./line";

export interface LineScore {
  home: number;
  away: number;
}

export interface MatchState {
  status: EventStatus;
  fullTime: LineScore | null;
  firstHalf: LineScore | null;
  /** Explicit second-half score; derived from fullTime − firstHalf when absent. */
  secondHalf: LineScore | null;
  extraTime: LineScore | null;
  penalties: LineScore | null;
  corners: LineScore | null;
  cards: LineScore | null;
}

export interface SettleableSelection {
  family: MarketFamily;
  marketType: MarketType;
  period: Period;
  participant?: Participant;
  line?: string;
  outcome: string;
}

export interface SettleAssessment {
  state: SettlementState;
  notes: string[];
}

export type SettleCoreResult =
  { kind: "settled"; assessment: SettleAssessment } | { kind: "unknown"; reason: string };

export function periodScore(match: MatchState, period: Period): LineScore | undefined {
  switch (period) {
    case Period.FULL_MATCH:
      return match.fullTime ?? undefined;
    case Period.FIRST_HALF:
      return match.firstHalf ?? undefined;
    case Period.SECOND_HALF:
      if (match.secondHalf !== null) return match.secondHalf;
      if (match.firstHalf !== null && match.fullTime !== null) {
        return {
          home: match.fullTime.home - match.firstHalf.home,
          away: match.fullTime.away - match.firstHalf.away,
        };
      }
      return undefined;
    case Period.EXTRA_TIME:
      return match.extraTime ?? undefined;
    case Period.PENALTIES:
      return match.penalties ?? undefined;
  }
}

function singleState(result: ComponentResult, notes: string[]): SettleAssessment {
  return {
    state: { result: settlementResultFromComponents([result]), components: [result] },
    notes,
  };
}

function combinedState(components: ComponentResult[], notes: string[]): SettleAssessment {
  return { state: { result: settlementResultFromComponents(components), components }, notes };
}

function settleTotal(actual: number, line: string | undefined, outcome: string): SettleCoreResult {
  if (line === undefined) {
    return { kind: "unknown", reason: "line is required for total markets" };
  }
  const lines = splitAsianLine(line);
  if (lines === undefined) {
    return { kind: "unknown", reason: `invalid line "${line}"` };
  }
  if (outcome !== "OVER" && outcome !== "UNDER") {
    return { kind: "unknown", reason: `outcome "${outcome}" is not OVER/UNDER` };
  }
  const components = lines.map((componentLine) => {
    const value = parseCanonicalLine(componentLine)!;
    const compare = actual > value ? 1 : actual === value ? 0 : -1;
    return outcome === "OVER"
      ? compare > 0
        ? ComponentResult.WIN
        : compare === 0
          ? ComponentResult.PUSH
          : ComponentResult.LOSS
      : compare < 0
        ? ComponentResult.WIN
        : compare === 0
          ? ComponentResult.PUSH
          : ComponentResult.LOSS;
  });
  const notes =
    lines.length === 2
      ? [`quarter line ${line} split 50/50 across ${lines[0]} and ${lines[1]}`]
      : [`actual ${actual} vs line ${line}`];
  return { kind: "settled", assessment: combinedState(components, notes) };
}

function settleHandicap(
  margin: number,
  line: string | undefined,
  side: Participant
): SettleCoreResult {
  if (line === undefined) {
    return { kind: "unknown", reason: "line is required for handicap markets" };
  }
  const lines = splitAsianLine(line);
  if (lines === undefined) {
    return { kind: "unknown", reason: `invalid line "${line}"` };
  }
  const components = lines.map((componentLine) => {
    const value = parseCanonicalLine(componentLine)!;
    const adjusted = side === Participant.HOME ? margin + value : value - margin;
    return adjusted > 0
      ? ComponentResult.WIN
      : adjusted < 0
        ? ComponentResult.LOSS
        : ComponentResult.PUSH;
  });
  const notes =
    lines.length === 2
      ? [`quarter line ${line} split 50/50 across ${lines[0]} and ${lines[1]}`]
      : [`actual margin ${margin} vs line ${line}`];
  return { kind: "settled", assessment: combinedState(components, notes) };
}

function settleResultMarket(margin: number, outcome: string): SettleCoreResult {
  if (outcome === "HOME") {
    return {
      kind: "settled",
      assessment: singleState(margin > 0 ? ComponentResult.WIN : ComponentResult.LOSS, []),
    };
  }
  if (outcome === "AWAY") {
    return {
      kind: "settled",
      assessment: singleState(margin < 0 ? ComponentResult.WIN : ComponentResult.LOSS, []),
    };
  }
  if (outcome === "DRAW") {
    return {
      kind: "settled",
      assessment: singleState(margin === 0 ? ComponentResult.WIN : ComponentResult.LOSS, []),
    };
  }
  if (outcome === "HOME_OR_DRAW") {
    return {
      kind: "settled",
      assessment: singleState(margin >= 0 ? ComponentResult.WIN : ComponentResult.LOSS, []),
    };
  }
  if (outcome === "AWAY_OR_DRAW") {
    return {
      kind: "settled",
      assessment: singleState(margin <= 0 ? ComponentResult.WIN : ComponentResult.LOSS, []),
    };
  }
  if (outcome === "HOME_OR_AWAY") {
    return {
      kind: "settled",
      assessment: singleState(margin !== 0 ? ComponentResult.WIN : ComponentResult.LOSS, []),
    };
  }
  return { kind: "unknown", reason: `unsupported outcome "${outcome}" for result market` };
}

function settleBTTS(score: LineScore, outcome: string): SettleCoreResult {
  const bothScored = score.home >= 1 && score.away >= 1;
  if (outcome === "BTTS_YES") {
    return {
      kind: "settled",
      assessment: singleState(bothScored ? ComponentResult.WIN : ComponentResult.LOSS, []),
    };
  }
  if (outcome === "BTTS_NO") {
    return {
      kind: "settled",
      assessment: singleState(bothScored ? ComponentResult.LOSS : ComponentResult.WIN, []),
    };
  }
  return { kind: "unknown", reason: `unsupported outcome "${outcome}" for BTTS` };
}

function settleExactScore(score: LineScore, outcome: string): SettleCoreResult {
  if (!/^[0-9]+-[0-9]+$/.test(outcome)) {
    return { kind: "unknown", reason: `exact-score outcome "${outcome}" is not "H-A"` };
  }
  const [home, away] = outcome.split("-").map((part) => Number(part));
  const matches = home === score.home && away === score.away;
  return {
    kind: "settled",
    assessment: singleState(matches ? ComponentResult.WIN : ComponentResult.LOSS, []),
  };
}

/** Evaluate a selection against a match state without rule-version concerns. */
export function settleSelection(
  selection: SettleableSelection,
  match: MatchState
): SettleCoreResult {
  if (
    match.status === EventStatus.CANCELLED ||
    match.status === EventStatus.ABANDONED ||
    match.status === EventStatus.POSTPONED
  ) {
    return {
      kind: "settled",
      assessment: combinedState([ComponentResult.VOID], [`event status ${match.status}: void`]),
    };
  }
  if (match.status !== EventStatus.FINISHED) {
    return { kind: "unknown", reason: `event is not finished (status ${match.status})` };
  }

  switch (selection.family) {
    case MarketFamily.MATCH_TOTAL:
    case MarketFamily.ASIAN_TOTAL: {
      const score = periodScore(match, selection.period);
      if (score === undefined) {
        return { kind: "unknown", reason: `missing ${selection.period} score for total market` };
      }
      return settleTotal(score.home + score.away, selection.line, selection.outcome);
    }
    case MarketFamily.TEAM_TOTAL:
    case MarketFamily.TEAM_ASIAN_TOTAL: {
      const score = periodScore(match, selection.period);
      if (score === undefined) {
        return { kind: "unknown", reason: `missing ${selection.period} score for team total` };
      }
      const side = selection.participant;
      if (side === undefined) {
        return { kind: "unknown", reason: "participant is required for a team total" };
      }
      const actual = side === Participant.HOME ? score.home : score.away;
      return settleTotal(actual, selection.line, selection.outcome);
    }
    case MarketFamily.ASIAN_HANDICAP: {
      const score = periodScore(match, selection.period);
      if (score === undefined) {
        return { kind: "unknown", reason: `missing ${selection.period} score for handicap` };
      }
      if (selection.outcome !== "HOME" && selection.outcome !== "AWAY") {
        return {
          kind: "unknown",
          reason: `handicap outcome "${selection.outcome}" is not HOME/AWAY`,
        };
      }
      const side = selection.participant ?? (selection.outcome as Participant);
      return settleHandicap(score.home - score.away, selection.line, side);
    }
    case MarketFamily.CORNERS: {
      if (match.corners === null) {
        return { kind: "unknown", reason: "missing corner count for corners market" };
      }
      return settleTotal(
        match.corners.home + match.corners.away,
        selection.line,
        selection.outcome
      );
    }
    case MarketFamily.CARDS: {
      if (match.cards === null) {
        return { kind: "unknown", reason: "missing card count for cards market" };
      }
      return settleTotal(match.cards.home + match.cards.away, selection.line, selection.outcome);
    }
    case MarketFamily.MATCH_RESULT:
    case MarketFamily.DOUBLE_CHANCE: {
      const score = periodScore(match, selection.period);
      if (score === undefined) {
        return { kind: "unknown", reason: `missing ${selection.period} score for result market` };
      }
      return settleResultMarket(score.home - score.away, selection.outcome);
    }
    case MarketFamily.BTTS: {
      const score = periodScore(match, selection.period);
      if (score === undefined) {
        return { kind: "unknown", reason: `missing ${selection.period} score for BTTS` };
      }
      return settleBTTS(score, selection.outcome);
    }
    case MarketFamily.EXACT_SCORE: {
      const score = periodScore(match, selection.period);
      if (score === undefined) {
        return { kind: "unknown", reason: `missing ${selection.period} score for exact score` };
      }
      return settleExactScore(score, selection.outcome);
    }
    default:
      return { kind: "unknown", reason: "UNKNOWN_SETTLEMENT: family has no settlement rule" };
  }
}
