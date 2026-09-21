import {
  canonicalEventSchema,
  canonicalSelectionSchema,
  marketStructureSchema,
  MarketType,
  parseDecimalOdds,
  type CanonicalEvent,
  type CanonicalSelection,
} from "@22void/domain";

import type { ProviderEnvelope, ProviderMarket } from "./envelope";
import { providerMarketCanonicalSchema } from "./envelope";
import type { ProviderMarketCanonical } from "./envelope";

/**
 * Convert an adapter envelope into canonical domain records (Phase 3 gate).
 *
 * The full event/market normalization engine (aliases, duplicate prevention,
 * cross-source matching) is Phase 4/5. This module performs the provider-level
 * identity mapping the envelope needs to become CanonicalEvent /
 * MarketStructure / CanonicalSelection records with timestamps, and rejects
 * (rather than guesses at) any record that cannot be formed canonically.
 *
 * Provisional naming note: until cross-source matching (Phase 4) exists, the
 * canonicalEventId is `<provider>:<providerEventId>`. Timeline fields follow
 * the freshness model (§38): observedAt = ingestion time; sourceUpdatedAt is
 * clamped to receivedAt so provider clock-skew cannot create negative ages.
 */

export interface ProviderRejection {
  ref: string;
  reason: string;
}

export interface CanonicalProviderRecords {
  events: CanonicalEvent[];
  markets: ProviderMarketCanonical[];
  selections: CanonicalSelection[];
  rejected: ProviderRejection[];
}

/** Clamp a provider timestamp so it can never be after the ingest time. */
function clampSourceTimestamp(sourceUpdatedAt: string, receivedAt: string): string {
  return new Date(Math.min(Date.parse(sourceUpdatedAt), Date.parse(receivedAt))).toISOString();
}

function buildMarketStructure(market: ProviderMarket) {
  return marketStructureSchema.parse({
    family: market.family,
    period: market.period,
    marketType: market.marketType,
    participant: market.participant,
    line: market.line,
  });
}

export function envelopeToCanonicalRecords(
  envelopeInput: ProviderEnvelope
): CanonicalProviderRecords {
  const envelope = envelopeInput;
  const records: CanonicalProviderRecords = {
    events: [],
    markets: [],
    selections: [],
    rejected: [],
  };
  const { provider, receivedAt } = envelope;

  for (const event of envelope.events) {
    const eventRef = `${provider}:${event.providerEventId}`;

    const parsedEvent = canonicalEventSchema.safeParse({
      canonicalEventId: eventRef,
      sport: "football",
      competition: event.competition,
      homeTeam: event.homeTeam,
      awayTeam: event.awayTeam,
      startTime: event.startTime,
      status: event.status,
      sourceEventIds: [{ provider, sourceEventId: event.providerEventId }],
    });
    if (!parsedEvent.success) {
      records.rejected.push({ ref: eventRef, reason: parsedEvent.error.message });
      continue;
    }
    records.events.push(parsedEvent.data);

    for (const market of event.markets) {
      const marketRef = `${eventRef}:${market.sourceMarketId}`;
      let structure;
      try {
        structure = buildMarketStructure(market);
      } catch (error) {
        const message = error instanceof Error ? error.message : "invalid market structure";
        records.rejected.push({ ref: marketRef, reason: message });
        continue;
      }

      const parsedMarket = providerMarketCanonicalSchema.safeParse({
        sourceMarketId: market.sourceMarketId,
        providerEventId: event.providerEventId,
        structure,
      });
      if (!parsedMarket.success) {
        records.rejected.push({ ref: marketRef, reason: parsedMarket.error.message });
        continue;
      }
      records.markets.push(parsedMarket.data);

      for (const price of market.prices) {
        for (const selection of price.selections) {
          const selectionRef = `${marketRef}:${price.bookmakerKey}:${selection.outcome}`;
          const parsedSelection = canonicalSelectionSchema.safeParse({
            selectionId: selectionRef,
            market: structure,
            bookmakerId: price.bookmakerKey,
            oddsSourceId: provider,
            outcome: selection.outcome,
            odds: parseDecimalOdds(selection.odds),
            observedAt: receivedAt,
            sourceUpdatedAt: clampSourceTimestamp(selection.sourceUpdatedAt, receivedAt),
          });
          if (!parsedSelection.success) {
            records.rejected.push({ ref: selectionRef, reason: parsedSelection.error.message });
            continue;
          }
          records.selections.push(parsedSelection.data);
        }
      }
    }
  }

  return records;
}

/** Concise summary used by scanners/workers and the Phase 3 gate tests. */
export function summarizeCanonicalRecords(records: CanonicalProviderRecords) {
  return {
    events: records.events.length,
    markets: records.markets.length,
    selections: records.selections.length,
    rejected: records.rejected.length,
  };
}

export { MarketType };
