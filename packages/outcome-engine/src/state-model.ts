/**
 * Football score-state model (spec §16–§20).
 *
 * Reduces the infinite score space to a small set of *equivalence classes*:
 * representative states whose settlement vector (one `SettlementResult` per
 * selection) is identical for every score inside the class. Boundaries are
 * derived from the selections themselves — every market line (totals, Asian
 * lines, handicaps, team lines), plus the implicit boundaries of result/BTTS/
 * exact-score markets — and the space is only enumerated up to
 * `max(ceil(boundary)) + 1`, beyond which all scores settle identically for
 * the given selections.
 *
 * Goal states enumerate `(fullTime, firstHalf)` when any selection is a
 * first/second-half market, so period markets partition correctly. Corners and
 * cards are independent count dimensions and are composed as a cross product
 * of their own classes. Classification always goes through the Phase 6
 * settlement engine — the state model never re-implements settlement logic.
 *
 * Selections the engine cannot settle (unsupported period, missing rule) are
 * never guessed; they are reported in `unknown` and excluded from the vectors
 * (Rule 3, `RejectionReason.NO_STATE_MODEL` / `UNKNOWN_SETTLEMENT`).
 */

import {
  EventStatus,
  MarketFamily,
  Period,
  RejectionReason,
  returnMultiplier,
} from "@22void/domain";
import type { SettlementResult } from "@22void/domain";
import { parseCanonicalLine, settleSelection } from "@22void/settlement";
import type { MatchState, SettleableSelection } from "@22void/settlement";

import type { FootballScore, MetricCounts } from "./score";

/** A representative score state and its settlement vector. */
export interface OutcomeState {
  /** Stable identifier built from the representative score / count classes. */
  id: string;
  /** Representative goal score; all scores in the class settle identically. */
  representative: FootballScore;
  /** Representative first-half score when a period market is present. */
  firstHalf: FootballScore | null;
  /** Representative corner count when a corner market is present. */
  corners: MetricCounts | null;
  /** Representative card count when a card market is present. */
  cards: MetricCounts | null;
  /** Settlement result per settled selection (aligned with `selectionIndices`). */
  vector: SettlementResult[];
}

/** A selection the engine could not settle, with the reason from Phase 6. */
export interface StateModelUnknown {
  /** Index into the input selection array. */
  index: number;
  reason: string;
}

export interface StateModelResult {
  states: OutcomeState[];
  /** Input index of each settled selection, aligned with `OutcomeState.vector`. */
  selectionIndices: number[];
  /** Selections excluded from the model because they cannot settle. */
  unknown: StateModelUnknown[];
}

export interface StateModelOptions {
  /** Hard cap on the enumerated goal value per side (default: derived, cap 12). */
  maxGoals?: number;
  /** Hard cap on the enumerated corner count per side (default: derived, cap 20). */
  maxCorners?: number;
  /** Hard cap on the enumerated card count per side (default: derived, cap 12). */
  maxCards?: number;
}

export interface VectorResult {
  /** `null` at every index the engine could not settle. */
  results: (SettlementResult | null)[];
  unknownIndices: number[];
}

const DEFAULT_GOAL_CAP = 12;
const DEFAULT_CORNER_CAP = 20;
const DEFAULT_CARD_CAP = 12;

const EXACT_SCORE_PATTERN = /^([0-9]+)-([0-9]+)$/;

function matchState(
  fullTime: FootballScore,
  firstHalf: FootballScore | null,
  corners: MetricCounts | null,
  cards: MetricCounts | null
): MatchState {
  return {
    status: EventStatus.FINISHED,
    fullTime: { home: fullTime.homeGoals, away: fullTime.awayGoals },
    firstHalf: firstHalf === null ? null : { home: firstHalf.homeGoals, away: firstHalf.awayGoals },
    secondHalf: null,
    extraTime: null,
    penalties: null,
    corners,
    cards,
  };
}

/**
 * Highest boundary implied by the selections: the largest `ceil(line)` plus the
 * implicit boundaries of binary markets (result/double chance/BTTS need 1, an
 * exact scoreline needs its own coordinates).
 */
export function boundaryMax(selections: readonly SettleableSelection[]): number {
  let max = 0;
  for (const selection of selections) {
    if (selection.line !== undefined) {
      const value = parseCanonicalLine(selection.line);
      if (value !== undefined) max = Math.max(max, Math.ceil(Math.abs(value)));
    }
    if (selection.family === MarketFamily.EXACT_SCORE) {
      const parsed = EXACT_SCORE_PATTERN.exec(selection.outcome);
      if (parsed !== null) {
        max = Math.max(max, Number(parsed[1] ?? 0), Number(parsed[2] ?? 0));
      }
    }
    if (
      selection.family === MarketFamily.BTTS ||
      selection.family === MarketFamily.MATCH_RESULT ||
      selection.family === MarketFamily.DOUBLE_CHANCE
    ) {
      max = Math.max(max, 1);
    }
  }
  return max;
}

function resolveLimit(explicit: number | undefined, boundary: number, cap: number): number {
  if (explicit !== undefined) return Math.max(explicit, 0);
  return Math.min(Math.max(boundary + 1, 2), cap);
}

function isHalfPeriod(period: Period): boolean {
  return period === Period.FIRST_HALF || period === Period.SECOND_HALF;
}

/** Settles every selection against one match state. */
export function settleVector(
  selections: readonly SettleableSelection[],
  match: MatchState
): VectorResult {
  const results: (SettlementResult | null)[] = [];
  const unknownIndices: number[] = [];
  selections.forEach((selection, index) => {
    const outcome = settleSelection(selection, match);
    if (outcome.kind === "settled") {
      results.push(outcome.assessment.state.result);
    } else {
      results.push(null);
      unknownIndices.push(index);
    }
  });
  return { results, unknownIndices };
}

interface GoalClass {
  id: string;
  full: FootballScore;
  first: FootballScore | null;
}

interface CountClass {
  id: string;
  counts: MetricCounts | null;
}

function buildGoalClasses(
  selections: readonly SettleableSelection[],
  maxGoals: number | undefined
): GoalClass[] {
  if (selections.length === 0) {
    return [{ id: "g:-", full: { homeGoals: 0, awayGoals: 0 }, first: null }];
  }

  const halfSelections = selections.filter((selection) => isHalfPeriod(selection.period));
  const needsHalf = halfSelections.length > 0;
  const fullLimit = resolveLimit(maxGoals, boundaryMax(selections), DEFAULT_GOAL_CAP);
  const firstLimit = needsHalf
    ? resolveLimit(maxGoals, boundaryMax(halfSelections), DEFAULT_GOAL_CAP)
    : 0;

  const classes = new Map<string, GoalClass>();

  for (let home = 0; home <= fullLimit; home += 1) {
    for (let away = 0; away <= fullLimit; away += 1) {
      const full = { homeGoals: home, awayGoals: away };
      if (!needsHalf) {
        const key = settleVector(selections, matchState(full, null, null, null))
          .results.map((result) => result ?? "?")
          .join(",");
        if (!classes.has(key)) classes.set(key, { id: `g:${home}-${away}`, full, first: null });
        continue;
      }
      for (let firstHome = 0; firstHome <= Math.min(home, firstLimit); firstHome += 1) {
        for (let firstAway = 0; firstAway <= Math.min(away, firstLimit); firstAway += 1) {
          const first = { homeGoals: firstHome, awayGoals: firstAway };
          const key = settleVector(selections, matchState(full, first, null, null))
            .results.map((result) => result ?? "?")
            .join(",");
          if (!classes.has(key)) {
            classes.set(key, { id: `g:${home}-${away}/${firstHome}-${firstAway}`, full, first });
          }
        }
      }
    }
  }

  return [...classes.values()];
}

function buildCountClasses(
  selections: readonly SettleableSelection[],
  tag: "c" | "k",
  max: number | undefined,
  cap: number
): CountClass[] {
  if (selections.length === 0) return [{ id: `${tag}:-`, counts: null }];

  const limit = resolveLimit(max, boundaryMax(selections), cap);
  const classes = new Map<string, CountClass>();

  for (let home = 0; home <= limit; home += 1) {
    for (let away = 0; away <= limit; away += 1) {
      const counts = { home, away };
      const match = matchState(
        { homeGoals: 0, awayGoals: 0 },
        null,
        tag === "c" ? counts : null,
        tag === "k" ? counts : null
      );
      const key = settleVector(selections, match)
        .results.map((result) => result ?? "?")
        .join(",");
      if (!classes.has(key)) classes.set(key, { id: `${tag}:${home}-${away}`, counts });
    }
  }

  return [...classes.values()];
}

/**
 * Builds the reduced state model for a candidate selection set (§17–§20).
 * Every returned state is a representative of an equivalence class: all scores
 * that reduce to it produce the identical settlement vector (Step 5 of the
 * reduction algorithm holds by construction).
 */
export function buildStateModel(
  selections: readonly SettleableSelection[],
  options: StateModelOptions = {}
): StateModelResult {
  const unknown: StateModelUnknown[] = [];
  const known: SettleableSelection[] = [];
  const selectionIndices: number[] = [];

  const probe = matchState(
    { homeGoals: 0, awayGoals: 0 },
    { homeGoals: 0, awayGoals: 0 },
    { home: 0, away: 0 },
    { home: 0, away: 0 }
  );

  selections.forEach((selection, index) => {
    if (selection.period === Period.EXTRA_TIME || selection.period === Period.PENALTIES) {
      unknown.push({
        index,
        reason: `${RejectionReason.NO_STATE_MODEL}: ${selection.period} is not part of the goal state model`,
      });
      return;
    }
    const outcome = settleSelection(selection, probe);
    if (outcome.kind === "unknown") {
      unknown.push({ index, reason: outcome.reason });
      return;
    }
    known.push(selection);
    selectionIndices.push(index);
  });

  if (known.length === 0) return { states: [], selectionIndices, unknown };

  const goalSelections = known.filter(
    (selection) =>
      selection.family !== MarketFamily.CORNERS && selection.family !== MarketFamily.CARDS
  );
  const cornerSelections = known.filter((selection) => selection.family === MarketFamily.CORNERS);
  const cardSelections = known.filter((selection) => selection.family === MarketFamily.CARDS);

  const goalClasses = buildGoalClasses(goalSelections, options.maxGoals);
  const cornerClasses = buildCountClasses(
    cornerSelections,
    "c",
    options.maxCorners,
    DEFAULT_CORNER_CAP
  );
  const cardClasses = buildCountClasses(cardSelections, "k", options.maxCards, DEFAULT_CARD_CAP);

  const states: OutcomeState[] = [];
  const seen = new Set<string>();

  for (const goalClass of goalClasses) {
    for (const cornerClass of cornerClasses) {
      for (const cardClass of cardClasses) {
        const match = matchState(
          goalClass.full,
          goalClass.first,
          cornerClass.counts,
          cardClass.counts
        );
        const { results, unknownIndices } = settleVector(known, match);
        if (unknownIndices.length > 0) continue;
        const vector = results.filter((result): result is SettlementResult => result !== null);
        const key = vector.join(",");
        if (seen.has(key)) continue;
        seen.add(key);
        states.push({
          id: `${goalClass.id}|${cornerClass.id}|${cardClass.id}`,
          representative: goalClass.full,
          firstHalf: goalClass.first,
          corners: cornerClass.counts,
          cards: cardClass.counts,
          vector,
        });
      }
    }
  }

  return { states, selectionIndices, unknown };
}

/** Settlement vector per state, in input order (§22 payoff/settlement matrix). */
export function settlementMatrix(states: readonly OutcomeState[]): SettlementResult[][] {
  return states.map((state) => [...state.vector]);
}

/**
 * Payoff matrix `A[state][selection] = returnMultiplier(result, odds)` (§22).
 * `odds` must align with each state's settlement vector.
 */
export function payoffMatrix(states: readonly OutcomeState[], odds: readonly number[]): number[][] {
  for (const state of states) {
    if (state.vector.length !== odds.length) {
      throw new Error(
        `payoffMatrix: odds length ${odds.length} does not match settlement vector length ${state.vector.length}`
      );
    }
  }
  return states.map((state) =>
    state.vector.map((result, index) => returnMultiplier(result, odds[index] ?? Number.NaN))
  );
}
