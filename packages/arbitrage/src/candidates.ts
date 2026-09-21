/**
 * Candidate generator (BUILD_AGENT_PROMPT Phase 10, spec §30–§34, §47, §61).
 *
 * Turns a flat list of priced selections into the leg sets worth evaluating.
 * Blind all-pairs comparison is forbidden (§33), so generation is staged:
 *
 * - Stage A — group by canonical event;
 * - Stage B — group by period (a period mismatch invalidates a candidate, §8);
 * - Stage C — only pair market families that have an implemented state model;
 * - Stage D — start at 2 legs, then 3, and only go larger where the structure
 *   suggests coverage; `maxCandidates` bounds the combinatorial explosion.
 *
 * Candidates are then pruned cheaply (§34) before the expensive Phase 8/9
 * checks: invalid odds, duplicate selections, suspended/stale legs, uncertain
 * events, incompatible markets and the classic exact-complement price prefilter
 * (§61). Pruning never decides arbitrage — the state model does. `scanCandidates`
 * is the convenience pipeline generate → prune → `detectFalseArb` → `optimizeStakes`.
 */

import { MarketFamily, SelectionOutcome } from "@22void/domain";
import type { Period } from "@22void/domain";
import type { StateModelOptions } from "@22void/outcome-engine";
import type { SettleableSelection } from "@22void/settlement";

import { detectFalseArb } from "./coverage";
import type { ArbitrageLeg, CoverageReport } from "./coverage";
import { optimizeStakes, reciprocalSum } from "./optimizer";
import type { StakePlan } from "./optimizer";

/** A priced selection ready for candidate generation. Structurally a leg. */
export interface PricedSelection {
  /** Stable identifier (e.g. normalized selection id + bookmaker). */
  id: string;
  eventId: string;
  selection: SettleableSelection;
  odds: number;
  bookmaker: string;
  /** Epoch milliseconds when the price was observed (freshness, Phase 11). */
  observedAt?: number;
  /** Provider/bookmaker suspension flag; suspended legs are pruned. */
  suspended?: boolean;
  /** Event-normalization confidence in [0, 1] (Phase 4). */
  eventConfidence?: number;
  /** Settlement rule version, part of the semantic cache key (§62). */
  settlementRuleVersion?: string;
}

export type StructureType =
  | "SAME_MARKET_COMPLEMENT"
  | "COMPLEMENTARY_TOTALS"
  | "ASIAN_LINE"
  | "PROTECTED_HANDICAP"
  | "TEAM_TOTAL_MATCH_TOTAL"
  | "PARTITION"
  | "MULTI_LEG_PARTITION"
  | "GENERIC";

export interface Candidate {
  id: string;
  eventId: string;
  period: Period;
  structureType: StructureType;
  legs: PricedSelection[];
}

export type PruneReason =
  | "CANDIDATE_SIZE"
  | "EVENT_MISMATCH"
  | "PERIOD_MISMATCH"
  | "DUPLICATE_SELECTION"
  | "INVALID_ODDS"
  | "SUSPENDED"
  | "STALE_ODDS"
  | "SAME_BOOKMAKER"
  | "EVENT_UNCERTAIN"
  | "INCOMPATIBLE_MARKET"
  | "PRICE_PREFILTER";

export interface PruneVerdict {
  reason: PruneReason;
  detail: string;
  legIds?: string[];
}

export interface CandidateGeneratorOptions {
  /** Restrict generation to one canonical event. */
  eventId?: string;
  /** Smallest candidate size to generate (default 2). */
  minLegs?: number;
  /** Largest candidate size to generate (default 3). */
  maxLegs?: number;
  /** Hard cap on generated candidates to bound combinatorics (default 20000). */
  maxCandidates?: number;
}

export interface CandidatePruneOptions {
  /** Allow legs sharing a bookmaker; off enforces a cross-book policy (§34). */
  allowSameBookmaker?: boolean;
  /** Minimum event-normalization confidence (default 0.8). */
  minEventConfidence?: number;
  /** Reject legs older than this (freshness policy, Phase 11). */
  maxAgeMs?: number;
  /** Clock override for age checks (default `Date.now()`). */
  now?: number;
}

export interface PruneResult {
  candidate: Candidate;
  verdicts: PruneVerdict[];
  pruned: boolean;
}

export interface ScanOptions extends CandidateGeneratorOptions, CandidatePruneOptions {
  totalStake?: number;
  stateModel?: StateModelOptions;
}

export interface CandidateScan {
  candidate: Candidate;
  pruning: PruneResult;
  coverage: CoverageReport | null;
  plan: StakePlan | null;
  status: "ARB" | "NO_ARB" | "REJECTED" | "PRUNED";
}

const MIN_DECIMAL_ODDS = 1.0000001;

/** Cross-family pairs that have an implemented state model (§33 Stage C). */
const COMPATIBLE_FAMILY_PAIRS: ReadonlyArray<readonly [MarketFamily, MarketFamily]> = [
  [MarketFamily.MATCH_TOTAL, MarketFamily.TEAM_TOTAL],
  [MarketFamily.MATCH_TOTAL, MarketFamily.ASIAN_TOTAL],
  [MarketFamily.TEAM_TOTAL, MarketFamily.ASIAN_TOTAL],
  [MarketFamily.MATCH_RESULT, MarketFamily.DOUBLE_CHANCE],
  [MarketFamily.MATCH_TOTAL, MarketFamily.BTTS],
];

const COMPATIBLE_PAIRS: ReadonlySet<string> = new Set(
  COMPATIBLE_FAMILY_PAIRS.map(([a, b]) => pairKey(a, b))
);

function pairKey(a: MarketFamily, b: MarketFamily): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** True when two market families may be combined in one candidate. */
export function familiesCompatible(a: MarketFamily, b: MarketFamily): boolean {
  return a === b || COMPATIBLE_PAIRS.has(pairKey(a, b));
}

function selectionKey(selection: SettleableSelection): string {
  return [
    selection.family,
    selection.marketType,
    selection.period,
    selection.participant ?? "-",
    selection.line ?? "-",
    selection.outcome,
  ].join("|");
}

function oppositeOutcome(a: string, b: string): boolean {
  return (
    (a === SelectionOutcome.OVER && b === SelectionOutcome.UNDER) ||
    (a === SelectionOutcome.UNDER && b === SelectionOutcome.OVER) ||
    (a === SelectionOutcome.BTTS_YES && b === SelectionOutcome.BTTS_NO) ||
    (a === SelectionOutcome.BTTS_NO && b === SelectionOutcome.BTTS_YES) ||
    (a === SelectionOutcome.HOME && b === SelectionOutcome.AWAY) ||
    (a === SelectionOutcome.AWAY && b === SelectionOutcome.HOME)
  );
}

/** A classic two-way exact complement (same family/period/participant/line). */
export function isStandardComplement(legs: readonly ArbitrageLeg[]): boolean {
  if (legs.length !== 2) return false;
  const [a, b] = legs;
  if (a === undefined || b === undefined) return false;
  return (
    a.selection.family === b.selection.family &&
    a.selection.period === b.selection.period &&
    (a.selection.participant ?? "-") === (b.selection.participant ?? "-") &&
    (a.selection.line ?? "-") === (b.selection.line ?? "-") &&
    oppositeOutcome(a.selection.outcome, b.selection.outcome)
  );
}

/** Classifies the candidate's structure for reporting and later scoring (§32). */
export function classifyStructure(legs: readonly ArbitrageLeg[]): StructureType {
  const families = new Set(legs.map((leg) => leg.selection.family));
  if (families.size > 1) {
    if (families.has(MarketFamily.TEAM_TOTAL) && families.has(MarketFamily.MATCH_TOTAL)) {
      return "TEAM_TOTAL_MATCH_TOTAL";
    }
    return legs.length >= 3 ? "MULTI_LEG_PARTITION" : "GENERIC";
  }

  const family = legs[0]?.selection.family;
  if (family === MarketFamily.MATCH_TOTAL) {
    return isStandardComplement(legs) ? "SAME_MARKET_COMPLEMENT" : "COMPLEMENTARY_TOTALS";
  }
  if (family === MarketFamily.ASIAN_TOTAL) return "ASIAN_LINE";
  if (family === MarketFamily.ASIAN_HANDICAP) return "PROTECTED_HANDICAP";
  if (family === MarketFamily.MATCH_RESULT || family === MarketFamily.DOUBLE_CHANCE) {
    return "PARTITION";
  }
  return legs.length >= 3 ? "MULTI_LEG_PARTITION" : "GENERIC";
}

function hasDuplicateSelection(legs: readonly PricedSelection[]): boolean {
  const seen = new Set<string>();
  for (const leg of legs) {
    const key = selectionKey(leg.selection);
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

function pairwiseCompatible(legs: readonly PricedSelection[]): boolean {
  for (let i = 0; i < legs.length; i += 1) {
    for (let j = i + 1; j < legs.length; j += 1) {
      if (!familiesCompatible(legs[i]!.selection.family, legs[j]!.selection.family)) {
        return false;
      }
    }
  }
  return true;
}

function* combinations<T>(items: readonly T[], size: number): Generator<T[]> {
  if (size > items.length) return;
  const indices = Array.from({ length: size }, (_, index) => index);
  for (;;) {
    yield indices.map((index) => items[index]!);
    let cursor = size - 1;
    while (cursor >= 0 && indices[cursor] === items.length - size + cursor) cursor -= 1;
    if (cursor < 0) return;
    indices[cursor] = indices[cursor]! + 1;
    for (let next = cursor + 1; next < size; next += 1) {
      indices[next] = indices[next - 1]! + 1;
    }
  }
}

function makeCandidate(legs: readonly PricedSelection[]): Candidate {
  const sorted = [...legs].sort((a, b) => a.id.localeCompare(b.id));
  const signature = sorted.map((leg) => leg.id).join("+");
  const period = sorted[0]!.selection.period;
  return {
    id: `${sorted[0]!.eventId}|${period}|${signature}`,
    eventId: sorted[0]!.eventId,
    period,
    structureType: classifyStructure(sorted),
    legs: sorted,
  };
}

/** Keeps the best price per distinct selection (spec §55 bookmaker selection). */
export function bestPricePerSelection(priced: readonly PricedSelection[]): PricedSelection[] {
  const best = new Map<string, PricedSelection>();
  for (const entry of priced) {
    const key = selectionKey(entry.selection);
    const current = best.get(key);
    if (current === undefined || entry.odds > current.odds) best.set(key, entry);
  }
  return [...best.values()];
}

/** Generates the staged candidate leg sets for the supplied priced selections. */
export function generateCandidates(
  priced: readonly PricedSelection[],
  options: CandidateGeneratorOptions = {}
): Candidate[] {
  const minLegs = options.minLegs ?? 2;
  const maxLegs = options.maxLegs ?? 3;
  const maxCandidates = options.maxCandidates ?? 20_000;

  const groups = new Map<string, PricedSelection[]>();
  for (const entry of priced) {
    if (options.eventId !== undefined && entry.eventId !== options.eventId) continue;
    const key = `${entry.eventId}|${entry.selection.period}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [entry]);
    else group.push(entry);
  }

  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  for (const group of groups.values()) {
    const upper = Math.min(maxLegs, group.length);
    for (let size = Math.max(minLegs, 2); size <= upper; size += 1) {
      for (const combo of combinations(group, size)) {
        if (hasDuplicateSelection(combo)) continue;
        if (!pairwiseCompatible(combo)) continue;
        const candidate = makeCandidate(combo);
        if (seen.has(candidate.id)) continue;
        seen.add(candidate.id);
        candidates.push(candidate);
        if (candidates.length >= maxCandidates) return candidates;
      }
    }
  }

  return candidates;
}

/** Cheap early rejection checks (§34, §61); returns every reason that applies. */
export function pruneCandidate(
  candidate: Candidate,
  options: CandidatePruneOptions = {}
): PruneVerdict[] {
  const verdicts: PruneVerdict[] = [];
  const legs = candidate.legs;

  if (legs.length < 2) {
    verdicts.push({ reason: "CANDIDATE_SIZE", detail: "candidate has fewer than two legs" });
  }

  for (const leg of legs) {
    if (leg.eventId !== candidate.eventId) {
      verdicts.push({
        reason: "EVENT_MISMATCH",
        detail: `leg ${leg.id} belongs to event ${leg.eventId}, not ${candidate.eventId}`,
        legIds: [leg.id],
      });
    }
    if (leg.selection.period !== candidate.period) {
      verdicts.push({
        reason: "PERIOD_MISMATCH",
        detail: `leg ${leg.id} is ${leg.selection.period}, candidate is ${candidate.period}`,
        legIds: [leg.id],
      });
    }
    if (!Number.isFinite(leg.odds) || leg.odds <= MIN_DECIMAL_ODDS) {
      verdicts.push({
        reason: "INVALID_ODDS",
        detail: `leg ${leg.id} has invalid odds ${leg.odds}`,
        legIds: [leg.id],
      });
    }
    if (leg.suspended === true) {
      verdicts.push({
        reason: "SUSPENDED",
        detail: `leg ${leg.id} is suspended`,
        legIds: [leg.id],
      });
    }
    const minConfidence = options.minEventConfidence ?? 0.8;
    if (leg.eventConfidence !== undefined && leg.eventConfidence < minConfidence) {
      verdicts.push({
        reason: "EVENT_UNCERTAIN",
        detail: `leg ${leg.id} event confidence ${leg.eventConfidence} < ${minConfidence}`,
        legIds: [leg.id],
      });
    }
    if (options.maxAgeMs !== undefined && leg.observedAt !== undefined) {
      const now = options.now ?? Date.now();
      if (now - leg.observedAt > options.maxAgeMs) {
        verdicts.push({
          reason: "STALE_ODDS",
          detail: `leg ${leg.id} observed ${now - leg.observedAt}ms ago (> ${options.maxAgeMs}ms)`,
          legIds: [leg.id],
        });
      }
    }
  }

  const duplicates = new Map<string, string[]>();
  for (const leg of legs) {
    const key = selectionKey(leg.selection);
    const ids = duplicates.get(key);
    if (ids === undefined) duplicates.set(key, [leg.id]);
    else ids.push(leg.id);
  }
  for (const [key, legIds] of duplicates) {
    if (legIds.length > 1) {
      verdicts.push({
        reason: "DUPLICATE_SELECTION",
        detail: `selection "${key}" appears on legs ${legIds.join(", ")}`,
        legIds,
      });
    }
  }

  if (options.allowSameBookmaker === false && legs.length >= 2) {
    const books = new Set(legs.map((leg) => leg.bookmaker));
    if (books.size < legs.length) {
      verdicts.push({
        reason: "SAME_BOOKMAKER",
        detail: `candidate reuses a bookmaker (${[...books].join(", ")})`,
        legIds: legs.map((leg) => leg.id),
      });
    }
  }

  if (!pairwiseCompatible(legs)) {
    verdicts.push({
      reason: "INCOMPATIBLE_MARKET",
      detail: `market families ${[...new Set(legs.map((leg) => leg.selection.family))].join(" + ")} cannot be combined`,
      legIds: legs.map((leg) => leg.id),
    });
  }

  if (isStandardComplement(legs) && reciprocalSum(legs.map((leg) => leg.odds)) >= 1) {
    verdicts.push({
      reason: "PRICE_PREFILTER",
      detail: `standard complement reciprocal sum ${reciprocalSum(legs.map((leg) => leg.odds))} >= 1`,
      legIds: legs.map((leg) => leg.id),
    });
  }

  return verdicts;
}

export function pruneCandidates(
  candidates: readonly Candidate[],
  options: CandidatePruneOptions = {}
): PruneResult[] {
  return candidates.map((candidate) => {
    const verdicts = pruneCandidate(candidate, options);
    return { candidate, verdicts, pruned: verdicts.length > 0 };
  });
}

/** Renders a prune verdict as a human-readable line (Rule 6). */
export function formatPruneVerdict(verdict: PruneVerdict): string {
  const suffix = verdict.legIds !== undefined ? ` | legs: ${verdict.legIds.join(", ")}` : "";
  return `${verdict.reason}: ${verdict.detail}${suffix}`;
}

/**
 * Full Phase 10 pipeline for one batch of priced selections: generate → prune →
 * false-arb detection → stake optimization. Only `ARB` results carry a positive
 * guaranteed return; `REJECTED`/`PRUNED` never reach the optimizer.
 */
export function scanCandidates(
  priced: readonly PricedSelection[],
  options: ScanOptions = {}
): CandidateScan[] {
  const totalStake = options.totalStake ?? 100;
  return generateCandidates(priced, options).map((candidate) => {
    const verdicts = pruneCandidate(candidate, options);
    const pruning: PruneResult = {
      candidate,
      verdicts,
      pruned: verdicts.length > 0,
    };
    if (pruning.pruned) {
      return { candidate, pruning, coverage: null, plan: null, status: "PRUNED" as const };
    }

    const coverage = detectFalseArb(candidate.legs, options.stateModel ?? {});
    if (coverage.status !== "COVERED") {
      return { candidate, pruning, coverage, plan: null, status: "REJECTED" as const };
    }

    const plan = optimizeStakes(coverage.states, coverage.legs, totalStake);
    return {
      candidate,
      pruning,
      coverage,
      plan,
      status: plan.isArb ? ("ARB" as const) : ("NO_ARB" as const),
    };
  });
}
