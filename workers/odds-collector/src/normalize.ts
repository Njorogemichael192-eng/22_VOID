/**
 * Normalize job (Phase 14).
 *
 * Feeds a poll's canonical records through the Phase-4 `EventNormalizer`:
 * provider events are merged against the events already known to the store,
 * the resulting canonical identity and match confidence are carried into the
 * persistence input (persisted into `source_event_ids.eventConfidence`), and
 * markets/selections are mapped to the DB identity model. Anything that cannot
 * be normalized or represented (exact-score free-form outcomes, unknown
 * markets) is carried as `invalid` and counted — never guessed.
 *
 * The DB keys markets by `(oddsSourceId, sourceMarketId)` so, because a
 * provider may reuse a market id across events, the persisted `sourceMarketId`
 * is the provider's *canonical market identity* `${providerEventId}:${
 * sourceMarketId}` — the same composite the canonical records already build.
 */

import type {
  PersistCanonicalRunInput,
  PersistEventInput,
  PersistInvalidRef,
  PersistMarketInput,
  PersistSelectionInput,
} from "@22void/db";
import { canonicalEventSchema, type CanonicalEvent } from "@22void/domain";
import { EventNormalizer, type NormalizeAction, type NormalizeResult } from "@22void/normalization";
import type { CanonicalProviderRecords } from "@22void/provider-contracts";

import type { PersistedEventSeed } from "./store.js";

/** One normalized event's decision, for observability/heartbeat summaries. */
export interface NormalizedEventSummary {
  canonicalEventId: string;
  sourceEventId: string;
  action: NormalizeAction;
  confidence: number;
  reasons: string[];
}

export interface NormalizeRunOutput {
  persist: PersistCanonicalRunInput;
  normalized: NormalizedEventSummary[];
}

function seedsToCanonical(seeds: PersistedEventSeed[]): CanonicalEvent[] {
  return seeds.map((seed) =>
    canonicalEventSchema.parse({
      canonicalEventId: seed.canonicalEventId,
      competition: seed.competition,
      homeTeam: seed.homeTeam,
      awayTeam: seed.awayTeam,
      startTime: seed.startTime,
      sourceEventIds: seed.sourceBindings,
    })
  );
}

/** The provider's canonical market identity persisted into `sourceMarketId`. */
export function canonicalMarketId(providerEventId: string, sourceMarketId: string): string {
  return `${providerEventId}:${sourceMarketId}`;
}

/**
 * Converts one poll's canonical records (plus the stored events to resume from)
 * into the persistence input for a scan cycle.
 */
export function normalizeRun(
  provider: string,
  records: CanonicalProviderRecords,
  seeds: PersistedEventSeed[]
): NormalizeRunOutput {
  const normalizer = new EventNormalizer({ seedEvents: seedsToCanonical(seeds) });
  const invalid: PersistInvalidRef[] = records.rejected.map((rejection) => ({
    ref: rejection.ref,
    reason: rejection.reason,
  }));
  const normalized: NormalizedEventSummary[] = [];
  const events: PersistEventInput[] = [];
  const markets: PersistMarketInput[] = [];
  const selections: PersistSelectionInput[] = [];

  const canonicalIdBySourceEventId = new Map<string, string>();

  for (const canonicalEvent of records.events) {
    const sourceEventId = canonicalEvent.sourceEventIds[0]?.sourceEventId;
    if (sourceEventId === undefined) {
      invalid.push({
        ref: canonicalEvent.canonicalEventId,
        reason: "event carries no provider source id",
      });
      continue;
    }
    let result: NormalizeResult;
    try {
      result = normalizer.register({
        provider,
        sourceEventId,
        homeTeam: canonicalEvent.homeTeam,
        awayTeam: canonicalEvent.awayTeam,
        competition: canonicalEvent.competition,
        startTime: canonicalEvent.startTime,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "normalization failed";
      invalid.push({ ref: canonicalEvent.canonicalEventId, reason });
      continue;
    }
    if (result.action === "uncertain" || result.canonicalEvent === undefined) {
      invalid.push({
        ref: canonicalEvent.canonicalEventId,
        reason: `UNCERTAIN_MATCH: ${result.reasons.join("; ")}`,
      });
      continue;
    }
    const resolvedEvent = result.canonicalEvent;
    const canonicalEventId = resolvedEvent.canonicalEventId;
    canonicalIdBySourceEventId.set(sourceEventId, canonicalEventId);
    normalized.push({
      canonicalEventId,
      sourceEventId,
      action: result.action,
      confidence: result.confidence,
      reasons: result.reasons,
    });
    events.push({
      canonicalEventId,
      ...(resolvedEvent.sport !== undefined ? { sport: resolvedEvent.sport } : {}),
      competition: resolvedEvent.competition,
      homeTeam: resolvedEvent.homeTeam,
      awayTeam: resolvedEvent.awayTeam,
      startTime: resolvedEvent.startTime,
      status: resolvedEvent.status as PersistEventInput["status"],
      sources: [{ provider, sourceEventId, eventConfidence: result.confidence }],
    });
  }

  /**
   * Map from a canonical selection's id prefix to the persisted (composite)
   * market id. Selection ids are built as
   * `${provider}:${providerEventId}:${sourceMarketId}:${bookmaker}:${outcome}`.
   */
  const selectionPrefixToMarket = new Map<string, string>();
  for (const market of records.markets) {
    const canonicalEventId = canonicalIdBySourceEventId.get(market.providerEventId);
    if (canonicalEventId === undefined) {
      invalid.push({
        ref: market.sourceMarketId,
        reason: `market references unknown provider event ${market.providerEventId}`,
      });
      continue;
    }
    const composite = canonicalMarketId(market.providerEventId, market.sourceMarketId);
    selectionPrefixToMarket.set(
      `${provider}:${market.providerEventId}:${market.sourceMarketId}:`,
      composite
    );
    markets.push({
      provider,
      sourceMarketId: composite,
      eventCanonicalId: canonicalEventId,
      family: market.structure.family as PersistMarketInput["family"],
      marketType: market.structure.marketType,
      period: market.structure.period as PersistMarketInput["period"],
      ...(market.structure.participant !== undefined
        ? { participant: market.structure.participant }
        : {}),
      ...(market.structure.line !== undefined ? { line: market.structure.line } : {}),
    });
  }

  for (const selection of records.selections) {
    let sourceMarketId: string | undefined;
    for (const [prefix, composite] of selectionPrefixToMarket) {
      if (selection.selectionId.startsWith(prefix)) {
        sourceMarketId = composite;
        break;
      }
    }
    if (sourceMarketId === undefined) {
      invalid.push({
        ref: selection.selectionId,
        reason: "selection does not map to a persisted market",
      });
      continue;
    }
    selections.push({
      provider,
      sourceMarketId,
      bookmaker: selection.bookmakerId,
      outcome: selection.outcome,
      odds: selection.odds,
      observedAt: selection.observedAt,
      ...(selection.sourceUpdatedAt !== undefined
        ? { sourceUpdatedAt: selection.sourceUpdatedAt }
        : {}),
    });
  }

  return { persist: { provider, events, markets, selections, invalid }, normalized };
}