import { EventStatus, type MarketFamily, type Participant, type Period } from "@22void/domain";

import type { ProviderKey } from "../provider-id";
import { type MarketKeySpec } from "./keys";
import { detectParticipant, mapOutcomeFor } from "./outcomes";

/**
 * Generic provider-wire → ProviderEnvelope translation (Phase 3).
 *
 * Both supported providers deliver the same event/bookmaker/market/outcome
 * shape (see the fixture raw payloads in tests/fixtures/providers/raw). This
 * module normalizes that generic shape into the canonical envelope using the
 * provider's market-key registry (keys.ts). Adapters remain responsible for
 * their own endpoint, auth and wire-schema concerns (ARCHITECTURE.md rule).
 */

export interface WireOutcome {
  name: string;
  price: number;
  point?: number | undefined;
}

export interface WireMarket {
  key: string;
  last_update?: string | undefined;
  outcomes: WireOutcome[];
}

export interface WireBookmaker {
  key: string;
  title?: string | undefined;
  last_update?: string | undefined;
  markets: WireMarket[];
}

export interface WireEvent {
  id: string;
  sport_key?: string | undefined;
  sport_title?: string | undefined;
  commence_time: string;
  home_team: string;
  away_team: string;
  status?: string | undefined;
  bookmakers: WireBookmaker[];
}

const LINE_REGEX = /^-?\d+(\.\d+)?$/;
const TRAILING_NUMBER_REGEX = /(?:^|\s)(-?\d+(?:[.,]\d+)?)$/;

/** Normalize a numeric point to a canonical decimal line string ("2.5", "-0.75"). */
export function formatLine(value: number | string | undefined): string | null {
  if (value === undefined) return null;
  const text = typeof value === "string" ? value : String(value);
  if (!LINE_REGEX.test(text)) return null;
  return text;
}

/** Extract a trailing numeric line from an outcome label ("Over 2.5" → "2.5"). */
export function extractLineFromLabel(label: string): string | null {
  const match = TRAILING_NUMBER_REGEX.exec(label.trim());
  if (match === null) return null;
  const group = match[1];
  if (group === undefined) return null;
  const normalized = group.replace(",", ".");
  return formatLine(normalized);
}

/** Outcome point if numeric, else the numeric suffix of the label. */
export function inferLine(outcome: WireOutcome): string | null {
  if (outcome.point !== undefined) {
    const fromPoint = formatLine(outcome.point);
    if (fromPoint !== null) return fromPoint;
  }
  return extractLineFromLabel(outcome.name);
}

export interface TranslatedOutcome {
  outcome: string;
  providerOutcome: string;
  odds: number;
  point?: string | undefined;
  sourceUpdatedAt: string;
}

export interface TranslatedPrice {
  bookmakerKey: string;
  bookmakerTitle?: string;
  sourceUpdatedAt: string;
  selections: TranslatedOutcome[];
}

export interface TranslatedMarket {
  sourceMarketId: string;
  family: MarketFamily;
  marketType: string;
  period: Period;
  participant?: Participant;
  line?: string;
  prices: TranslatedPrice[];
}

export interface TranslatedEvent {
  providerEventId: string;
  competition: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  status: EventStatus;
  markets: TranslatedMarket[];
}

export interface TranslatedEnvelope {
  provider: ProviderKey;
  requestId: string;
  receivedAt: string;
  sourceCollectedAt?: string;
  skippedOutcomes: string[];
  events: TranslatedEvent[];
}

export interface TeamTotalGroup {
  participant: Participant;
  line: string;
  outcomes: WireOutcome[];
}

function mapOutcomeSelection(
  outcome: WireOutcome,
  spec: MarketKeySpec,
  ctx: { homeTeam: string; awayTeam: string },
  sourceUpdatedAt: string
): TranslatedOutcome | null {
  if (!Number.isFinite(outcome.price) || outcome.price <= 1.0) return null;
  const canonicalOutcome = mapOutcomeFor(spec.family, spec.marketType, outcome.name, ctx);
  if (canonicalOutcome === null) return null;
  const line = inferLine(outcome);
  if (spec.usesPoint && line === null) return null;
  return {
    outcome: canonicalOutcome,
    providerOutcome: outcome.name,
    odds: outcome.price,
    ...(line !== null ? { point: line } : {}),
    sourceUpdatedAt,
  };
}

/** Group a team_totals wire market into per-participant, per-line groups. */
export function splitTeamTotals(
  market: WireMarket,
  ctx: { homeTeam: string; awayTeam: string },
  teamFallback: Participant | undefined
): TeamTotalGroup[] {
  const groups = new Map<string, TeamTotalGroup>();
  for (const outcome of market.outcomes) {
    const participant = detectParticipant(outcome.name, ctx) ?? teamFallback;
    const line = inferLine(outcome);
    if (participant === undefined || line === null) continue;
    const key = `${participant}|${line}`;
    const existing = groups.get(key);
    if (existing) {
      existing.outcomes.push(outcome);
      continue;
    }
    groups.set(key, { participant, line, outcomes: [outcome] });
  }
  return [...groups.values()];
}

/**
 * Translate a generic wire payload into the canonical envelope for the given
 * registry. `receivedAt` is the ingestion timestamp; provider timestamps are
 * carried through (dispatch-time clamping to receivedAt happens later in
 * envelopeToCanonicalRecords).
 */
export function translateProviderOdds(
  wireEvents: WireEvent[],
  registry: Readonly<Record<string, MarketKeySpec>>,
  provider: ProviderKey,
  requestId: string,
  receivedAt: string,
  competitionFor?: (event: WireEvent) => string,
  statusFor?: (event: WireEvent) => EventStatus,
  sourceCollectedAt?: string
): TranslatedEnvelope {
  const skippedOutcomes: string[] = [];
  const events: TranslatedEvent[] = [];

  for (const event of wireEvents) {
    const ctx = { homeTeam: event.home_team, awayTeam: event.away_team };
    const markets: TranslatedMarket[] = [];

    for (const bookmaker of event.bookmakers) {
      for (const market of bookmaker.markets) {
        const spec = registry[market.key];
        if (spec === undefined) {
          skippedOutcomes.push(`${bookmaker.key}:${market.key}:unknown_market`);
          continue;
        }

        const sourceUpdatedAt: string | undefined = market.last_update ?? bookmaker.last_update;
        if (sourceUpdatedAt === undefined) {
          skippedOutcomes.push(`${bookmaker.key}:${market.key}:missing_timestamp`);
          continue;
        }

        if (spec.teamSplit === "team_totals") {
          for (const group of splitTeamTotals(market, ctx, spec.teamFallback)) {
            const selections: TranslatedOutcome[] = [];
            for (const outcome of group.outcomes) {
              const mapped = mapOutcomeSelection(outcome, spec, ctx, sourceUpdatedAt);
              if (mapped === null) {
                skippedOutcomes.push(`${bookmaker.key}:${market.key}:${outcome.name}`);
                continue;
              }
              selections.push({ ...mapped, point: group.line });
            }
            if (selections.length === 0) continue;
            markets.push({
              sourceMarketId: `${market.key}::${group.participant}::${group.line}`,
              family: spec.family,
              marketType: spec.marketType,
              period: spec.period,
              participant: group.participant,
              line: group.line,
              prices: [
                {
                  bookmakerKey: bookmaker.key,
                  ...(bookmaker.title !== undefined ? { bookmakerTitle: bookmaker.title } : {}),
                  sourceUpdatedAt,
                  selections,
                },
              ],
            });
          }
          continue;
        }

        const priceGroup: TranslatedPrice = {
          bookmakerKey: bookmaker.key,
          ...(bookmaker.title !== undefined ? { bookmakerTitle: bookmaker.title } : {}),
          sourceUpdatedAt,
          selections: [],
        };
        for (const outcome of market.outcomes) {
          const selection = mapOutcomeSelection(outcome, spec, ctx, sourceUpdatedAt);
          if (selection === null) {
            skippedOutcomes.push(`${bookmaker.key}:${market.key}:${outcome.name}`);
            continue;
          }
          priceGroup.selections.push(selection);
        }
        if (priceGroup.selections.length === 0) continue;

        const firstLine = priceGroup.selections[0]?.point;
        markets.push({
          sourceMarketId: market.key,
          family: spec.family,
          marketType: spec.marketType,
          period: spec.period,
          ...(firstLine !== undefined ? { line: firstLine } : {}),
          prices: [priceGroup],
        });
      }
    }

    events.push({
      providerEventId: event.id,
      competition: competitionFor
        ? competitionFor(event)
        : (event.sport_title ?? event.sport_key ?? "football"),
      homeTeam: event.home_team,
      awayTeam: event.away_team,
      startTime: event.commence_time,
      status: statusFor ? statusFor(event) : EventStatus.SCHEDULED,
      markets,
    });
  }

  return {
    provider,
    requestId,
    receivedAt,
    ...(sourceCollectedAt !== undefined ? { sourceCollectedAt } : {}),
    skippedOutcomes,
    events,
  };
}
