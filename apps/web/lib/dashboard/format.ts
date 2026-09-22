/**
 * Dashboard display helpers (Phase 13). Pure string/number formatting used by
 * both server components and the client-side stake calculator, so it must stay
 * free of any Node/server dependencies.
 */

import type { MarketFamily, Period, SelectionOutcome } from "@22void/domain";

export const CURRENCY = "KSh";

const FAMILY_LABELS: Record<MarketFamily, string> = {
  MATCH_RESULT: "Match result",
  DOUBLE_CHANCE: "Double chance",
  MATCH_TOTAL: "Goals over/under",
  ASIAN_TOTAL: "Total goals (Asian)",
  ASIAN_HANDICAP: "Asian handicap",
  TEAM_TOTAL: "Team goals",
  TEAM_ASIAN_TOTAL: "Team goals (Asian)",
  CORNERS: "Corners over/under",
  CARDS: "Cards over/under",
  BTTS: "Both teams to score",
  EXACT_SCORE: "Correct score",
};

const PERIOD_LABELS: Record<Period, string> = {
  FULL_MATCH: "Full time",
  FIRST_HALF: "1st half",
  SECOND_HALF: "2nd half",
  EXTRA_TIME: "Extra time",
  PENALTIES: "Extra time – penalties",
};

const OUTCOME_LABELS: Record<SelectionOutcome, string> = {
  HOME: "Home",
  DRAW: "Draw",
  AWAY: "Away",
  OVER: "Over",
  UNDER: "Under",
  BTTS_YES: "Yes",
  BTTS_NO: "No",
  HOME_OR_DRAW: "Home or draw",
  AWAY_OR_DRAW: "Away or draw",
  HOME_OR_AWAY: "Home or away",
};

export function formatOdds(odds: number): string {
  return odds.toFixed(2);
}

export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${CURRENCY} ${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatPercent(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined) return "—";
  return `${(fraction * 100).toFixed(2)}%`;
}

export function formatRoi(roi: number | null | undefined): string {
  if (roi === null || roi === undefined) return "—";
  const sign = roi >= 0 ? "+" : "";
  return `${sign}${(roi * 100).toFixed(2)}%`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatAge(iso: string, now: number): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "—";
  const deltaMs = Math.max(0, now - at);
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function familyLabel(family: string): string {
  return FAMILY_LABELS[family as MarketFamily] ?? family;
}

export function periodLabel(period: string): string {
  return PERIOD_LABELS[period as Period] ?? period;
}

export function outcomeLabel(outcome: string | null | undefined): string {
  if (!outcome) return "—";
  return OUTCOME_LABELS[outcome as SelectionOutcome] ?? outcome;
}

export function participantLabel(participant: string | null | undefined): string {
  if (!participant) return "";
  return participant === "HOME" ? "Home" : participant === "AWAY" ? "Away" : participant;
}

export interface MarketParts {
  family: string;
  marketType?: string | null;
  period?: string | null;
  participant?: string | null;
  line?: string | null;
}

export function marketLabel(market: MarketParts): string {
  const family = familyLabel(market.family);
  const parts = [family];
  const participant = participantLabel(market.participant);
  if (participant) parts.unshift(participant);
  const period = market.period ? periodLabel(market.period) : null;
  if (period && period !== "Full time") parts.push(period);
  return parts.join(" · ");
}

export function selectionLabel(market: MarketParts, outcome: string | null | undefined): string {
  const outcomeText = outcomeLabel(outcome);
  const line = market.line;
  if (line !== null && line !== undefined && (outcome === "OVER" || outcome === "UNDER")) {
    return `${outcomeText} ${line}`;
  }
  return outcomeText;
}

export function countLabel(count: number, singular: string, plural: string): string {
  return count === 1 ? `1 ${singular}` : `${count} ${plural}`;
}
