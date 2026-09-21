/**
 * False-arb detector (BUILD_AGENT_PROMPT Phase 8, spec §27–§34, §40–§41).
 *
 * A candidate is only a real arbitrage structure when the reduced state model
 * (Phase 7) proves that every reachable state is covered. This module builds
 * that model, then runs the structural checks the reciprocal-sum shortcut
 * cannot do:
 *
 * - unknown settlement (a leg that cannot settle is never guessed, Rule 3);
 * - mutual exclusivity — same-metric legs must not both win in one state;
 * - collective exhaustiveness — no gap where no leg wins (push/gap);
 * - both-loss states — every leg loses in some state (§28).
 *
 * Cross-metric overlaps (e.g. team total + match total) are legal and only
 * recorded; the optimizer (Phase 9) decides profitability. A structurally
 * covered candidate is *not* yet an arb — only `minimum return > T` confirms
 * that. Every rejection carries machine-readable evidence (§41) and a
 * human-readable explanation.
 */

import { RejectionReason, SettlementResult } from "@22void/domain";
import { boundaryMax, buildStateModel } from "@22void/outcome-engine";
import type {
  FootballScore,
  MetricCounts,
  OutcomeState,
  StateModelOptions,
  StateModelUnknown,
} from "@22void/outcome-engine";
import type { SettleableSelection } from "@22void/settlement";

/** A single leg of an arbitrage candidate. */
export interface ArbitrageLeg {
  /** Stable identifier for the leg (e.g. the normalized selection id). */
  id: string;
  selection: SettleableSelection;
  /** Decimal odds for the leg. */
  odds: number;
  /** Bookmaker / provider label, when known. */
  bookmaker?: string;
}

/** How two winning legs relate: same settlement metric (illegal) or across metrics (legal). */
export type OverlapKind = "SAME_METRIC" | "CROSS_METRIC";

export interface StateOverlap {
  kind: OverlapKind;
  stateId: string;
  /** Family/period/participant signature the overlapping legs share. */
  metricKey: string;
  legIds: string[];
}

export interface StateGap {
  stateId: string;
  representative: FootballScore;
  firstHalf: FootballScore | null;
  settlements: SettlementResult[];
  legIds: string[];
}

/** Structured evidence attached to a rejection (§41). */
export interface RejectionEvidence {
  stateId?: string;
  representative?: FootballScore;
  firstHalf?: FootballScore | null;
  corners?: MetricCounts | null;
  cards?: MetricCounts | null;
  settlements?: SettlementResult[];
  legIds?: string[];
  metricKey?: string;
  /** Number of states exhibiting this rejection. */
  count?: number;
  unknown?: StateModelUnknown[];
}

export interface FalseArbVerdict {
  reason: RejectionReason;
  /** Human-readable explanation. */
  detail: string;
  evidence: RejectionEvidence;
}

export interface CoverageReport {
  status: "COVERED" | "REJECTED";
  legs: ArbitrageLeg[];
  states: OutcomeState[];
  /** Input leg index of each settled selection, aligned with each state vector. */
  selectionIndices: number[];
  unknown: StateModelUnknown[];
  /** States where two or more legs win together. */
  overlaps: StateOverlap[];
  /** States where no leg wins (uncovered). */
  gaps: StateGap[];
  rejections: FalseArbVerdict[];
  /** True when no two same-metric legs both win in any state. */
  exclusive: boolean;
  /** True when every state has at least one winning leg. */
  exhaustive: boolean;
}

const WINNING: ReadonlySet<SettlementResult> = new Set([
  SettlementResult.FULL_WIN,
  SettlementResult.HALF_WIN,
]);

function metricKey(selection: SettleableSelection): string {
  return [selection.family, selection.period, selection.participant ?? "-"].join("|");
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

function toSettlementResult(value: SettlementResult | null): SettlementResult {
  return value ?? "FULL_LOSS";
}

function legIdsFor(legs: readonly ArbitrageLeg[], indices: readonly number[]): string[] {
  return indices.map((index) => legs[index]?.id ?? `#${index}`);
}

function modelOptions(
  selections: readonly SettleableSelection[],
  options: StateModelOptions
): StateModelOptions {
  const required = boundaryMax(selections) + 1;
  return {
    maxGoals: options.maxGoals ?? Math.min(Math.max(required, 2), 40),
    maxCorners: options.maxCorners ?? Math.min(Math.max(required + 10, 2), 60),
    maxCards: options.maxCards ?? Math.min(Math.max(required, 2), 40),
  };
}

function emptyReport(legs: readonly ArbitrageLeg[]): CoverageReport {
  return {
    status: "REJECTED",
    legs: [...legs],
    states: [],
    selectionIndices: [],
    unknown: [],
    overlaps: [],
    gaps: [],
    rejections: [],
    exclusive: true,
    exhaustive: true,
  };
}

function duplicateLegs(legs: readonly ArbitrageLeg[]): { key: string; legIds: string[] }[] {
  const byKey = new Map<string, string[]>();
  for (const leg of legs) {
    const key = selectionKey(leg.selection);
    const ids = byKey.get(key);
    if (ids === undefined) byKey.set(key, [leg.id]);
    else ids.push(leg.id);
  }
  return [...byKey.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, legIds]) => ({ key, legIds }));
}

function pushRejection(rejections: FalseArbVerdict[], verdict: FalseArbVerdict): void {
  const existing = rejections.find((entry) => entry.reason === verdict.reason);
  if (existing === undefined) {
    rejections.push({
      ...verdict,
      evidence: { ...verdict.evidence, count: 1 },
    });
    return;
  }
  existing.evidence.count = (existing.evidence.count ?? 1) + 1;
}

/**
 * Validates a candidate against every reachable state (§27–§34) and returns a
 * structured coverage report. A `COVERED` report only means the structure is
 * sound; profitability is decided by the Phase 9 optimizer.
 */
export function detectFalseArb(
  legs: readonly ArbitrageLeg[],
  options: StateModelOptions = {}
): CoverageReport {
  if (legs.length === 0) {
    const report = emptyReport(legs);
    report.rejections.push({
      reason: RejectionReason.INVALID_MARKET,
      detail: "candidate has no legs",
      evidence: {},
    });
    return report;
  }

  const duplicates = duplicateLegs(legs);
  if (duplicates.length > 0) {
    const report = emptyReport(legs);
    for (const duplicate of duplicates) {
      report.rejections.push({
        reason: RejectionReason.INVALID_MARKET,
        detail: `duplicate selection "${duplicate.key}" appears on legs ${duplicate.legIds.join(", ")}`,
        evidence: { legIds: duplicate.legIds },
      });
    }
    return report;
  }

  const selections = legs.map((leg) => leg.selection);
  const model = buildStateModel(selections, modelOptions(selections, options));
  const rejections: FalseArbVerdict[] = [];

  if (model.unknown.length > 0) {
    rejections.push({
      reason: RejectionReason.UNKNOWN_SETTLEMENT,
      detail: `${model.unknown.length} leg(s) cannot be settled: ${model.unknown
        .map((entry) => `leg ${entry.index}: ${entry.reason}`)
        .join("; ")}`,
      evidence: {
        unknown: model.unknown,
        legIds: legIdsFor(
          legs,
          model.unknown.map((u) => u.index)
        ),
      },
    });
    return {
      ...emptyReport(legs),
      states: model.states,
      selectionIndices: model.selectionIndices,
      unknown: model.unknown,
      rejections,
      exhaustive: false,
      exclusive: false,
    };
  }

  const overlaps: StateOverlap[] = [];
  const gaps: StateGap[] = [];

  for (const state of model.states) {
    const winningIndices: number[] = [];
    const losingIndices: number[] = [];
    state.vector.forEach((result, index) => {
      if (WINNING.has(result)) winningIndices.push(index);
      else if (result === SettlementResult.FULL_LOSS) losingIndices.push(index);
    });

    if (winningIndices.length >= 2) {
      const byMetric = new Map<string, number[]>();
      for (const index of winningIndices) {
        const key = metricKey(selections[index]!);
        const group = byMetric.get(key);
        if (group === undefined) byMetric.set(key, [index]);
        else group.push(index);
      }
      for (const [key, group] of byMetric) {
        if (group.length >= 2) {
          const legIds = legIdsFor(legs, group);
          overlaps.push({ kind: "SAME_METRIC", stateId: state.id, metricKey: key, legIds });
          pushRejection(rejections, {
            reason: RejectionReason.NON_EXCLUSIVE,
            detail: `state ${state.id} (H${state.representative.homeGoals}-A${state.representative.awayGoals}) has overlapping winners on the same metric ${key}: ${legIds.join(", ")}`,
            evidence: {
              stateId: state.id,
              representative: state.representative,
              firstHalf: state.firstHalf,
              settlements: state.vector.map(toSettlementResult),
              legIds,
              metricKey: key,
            },
          });
        }
      }
      if (byMetric.size > 1) {
        overlaps.push({
          kind: "CROSS_METRIC",
          stateId: state.id,
          metricKey: [...byMetric.keys()].join(" + "),
          legIds: legIdsFor(legs, winningIndices),
        });
      }
    }

    if (winningIndices.length === 0) {
      const legIds = legIdsFor(
        legs,
        state.vector.map((_, index) => index)
      );
      gaps.push({
        stateId: state.id,
        representative: state.representative,
        firstHalf: state.firstHalf,
        settlements: state.vector.map(toSettlementResult),
        legIds,
      });
      const allLost = losingIndices.length === selections.length;
      if (allLost && selections.length >= 2) {
        pushRejection(rejections, {
          reason: RejectionReason.BOTH_LOSS_STATE,
          detail: `state ${state.id} (H${state.representative.homeGoals}-A${state.representative.awayGoals}) loses every leg: ${legIds.join(", ")}`,
          evidence: {
            stateId: state.id,
            representative: state.representative,
            firstHalf: state.firstHalf,
            settlements: state.vector.map(toSettlementResult),
            legIds,
          },
        });
      } else {
        pushRejection(rejections, {
          reason: RejectionReason.NON_EXHAUSTIVE,
          detail: `state ${state.id} (H${state.representative.homeGoals}-A${state.representative.awayGoals}) has no winning leg (push/gap)`,
          evidence: {
            stateId: state.id,
            representative: state.representative,
            firstHalf: state.firstHalf,
            corners: state.corners,
            cards: state.cards,
            settlements: state.vector.map(toSettlementResult),
            legIds,
          },
        });
      }
    }
  }

  const exclusive = !overlaps.some((overlap) => overlap.kind === "SAME_METRIC");
  const exhaustive = gaps.length === 0;

  return {
    status: rejections.length === 0 ? "COVERED" : "REJECTED",
    legs: [...legs],
    states: model.states,
    selectionIndices: model.selectionIndices,
    unknown: model.unknown,
    overlaps,
    gaps,
    rejections,
    exclusive,
    exhaustive,
  };
}

/** Renders a rejection as a human-readable line (§41). */
export function formatRejection(verdict: FalseArbVerdict): string {
  const parts = [`${verdict.reason}: ${verdict.detail}`];
  if (verdict.evidence.legIds !== undefined) {
    parts.push(`legs: ${verdict.evidence.legIds.join(", ")}`);
  }
  if (verdict.evidence.settlements !== undefined) {
    parts.push(`settlements: ${verdict.evidence.settlements.join(", ")}`);
  }
  return parts.join(" | ");
}

/** Renders the whole verdict as a multi-line explanation. */
export function formatCoverageReport(report: CoverageReport): string {
  const header = `candidate ${report.status} (${report.legs.length} legs, ${report.states.length} states)`;
  if (report.status === "COVERED")
    return `${header}\nexclusive=${report.exclusive} exhaustive=${report.exhaustive}`;
  return [header, ...report.rejections.map((verdict) => `- ${formatRejection(verdict)}`)].join(
    "\n"
  );
}
