/**
 * Pure view-model builders for the dashboard tables (Phase 13): the leg matrix,
 * the bookmaker-comparison grid, and the scanner summary. All functions derive
 * their output from `@22void/db` API views so they can be tested without a DB.
 */

import type { MarketView, OpportunityView, ScannerRunView } from "@22void/db";

import { marketLabel, selectionLabel } from "./format";

export interface LegRow {
  selectionId: string;
  bookmaker: string;
  outcome: string;
  selection: string;
  market: string;
  odds: number;
  stake: number | null;
  guaranteedReturn: number | null;
  settlementResult: string | null;
}

export function legRows(opp: OpportunityView): LegRow[] {
  return opp.legs.map((leg) => ({
    selectionId: leg.selectionId,
    bookmaker: leg.bookmaker,
    outcome: leg.outcome,
    selection: selectionLabel(leg.market, leg.outcome),
    market: marketLabel(leg.market),
    odds: leg.oddsSnapshot,
    stake: leg.stake,
    guaranteedReturn: leg.guaranteedReturn,
    settlementResult: leg.settlementResult,
  }));
}

export interface ComparisonCell {
  bookmaker: string;
  odds: number | null;
  /** True when this bookmaker carried the opportunity's leg at snapshot time. */
  usedInOpp: boolean;
  /** True when this cell holds the highest quoted odds for the outcome. */
  best: boolean;
}

export interface OutcomeComparison {
  outcome: string;
  selection: string;
  cells: ComparisonCell[];
}

export interface MarketComparison {
  marketId: string;
  marketLabel: string;
  snapshotBookmaker: string;
  outcomes: OutcomeComparison[];
}

/**
 * Builds a bookmaker-vs-outcome grid from the opportunity's legs plus the
 * currently available markets (fetched for the same event). The leg's snapshot
 * market is matched on family/period/participant/line so current prices can be
 * compared with the price the opportunity locked in.
 */
export function compareBookmakerOdds(
  opp: OpportunityView,
  markets: readonly MarketView[]
): MarketComparison[] {
  return opp.legs.map((leg) => {
    const current = markets.find(
      (market) =>
        market.family === leg.market.family &&
        market.period === leg.market.period &&
        (market.participant ?? null) === (leg.market.participant ?? null) &&
        (market.line ?? null) === (leg.market.line ?? null)
    );
    const outcomeKeys = current
      ? [...new Set(current.odds.map((odds) => odds.outcome))]
      : [leg.outcome];
    const outcomes: OutcomeComparison[] = outcomeKeys.map((outcome) => {
      const cells: ComparisonCell[] = (current?.odds ?? [])
        .filter((odds) => odds.outcome === outcome)
        .map((odds) => ({
          bookmaker: odds.bookmaker,
          odds: odds.odds,
          usedInOpp: odds.bookmaker === leg.bookmaker && outcome === leg.outcome,
          best: false,
        }));
      if (cells.length === 0 && current === undefined && outcome === leg.outcome) {
        cells.push({
          bookmaker: leg.bookmaker,
          odds: leg.oddsSnapshot,
          usedInOpp: true,
          best: true,
        });
      }
      const best = Math.max(...cells.map((cell) => cell.odds ?? 0), 0);
      for (const cell of cells) cell.best = cell.odds === best && cells.length > 1;
      return { outcome, selection: selectionLabel(leg.market, outcome), cells };
    });
    return {
      marketId: current?.id ?? leg.selectionId,
      marketLabel: marketLabel(leg.market),
      snapshotBookmaker: leg.bookmaker,
      outcomes,
    };
  });
}

export interface ScannerSummary {
  status: string;
  lastRunAt: string | null;
  runningRuns: number;
  stale: { sourceKey: string; since: string } | null;
  runs: ScannerRunView[];
}

const STALE_RUN_MS = 5 * 60 * 1000;

export function summarizeScanner(runs: readonly ScannerRunView[], now: number): ScannerSummary {
  const latest = runs.length > 0 ? runs[0] : null;
  const stale =
    latest !== null &&
    (() => {
      const anchor = latest.finishedAt ?? latest.startedAt;
      const at = Date.parse(anchor);
      return Number.isFinite(at) && now - at > STALE_RUN_MS;
    })()
      ? { sourceKey: latest.sourceKey ?? "unknown", since: latest.startedAt }
      : null;
  return {
    status: latest ? latest.status : "UNKNOWN",
    lastRunAt: latest ? latest.startedAt : null,
    runningRuns: runs.filter((run) => run.finishedAt === null).length,
    stale,
    runs: [...runs],
  };
}
