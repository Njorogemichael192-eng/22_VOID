import { z } from "zod";

import {
  EventStatus,
  eventStatusSchema,
  MarketFamily,
  marketFamilySchema,
  MarketType,
  Participant,
  participantSchema,
  Period,
  periodSchema,
} from "@22void/domain";

import { providerKeySchema } from "./provider-id";

/**
 * Canonical provider envelope (Phase 3).
 *
 * Every adapter — MockProvider, the Odds-API.io adapter and the ParlayAPI
 * adapter — converts its provider-specific wire payload into this normalized
 * envelope. The envelope carries canonical market taxonomy (family, type,
 * period, participant, line) and per-price source timestamps, so the core
 * engine never sees provider-specific shapes (ARCHITECTURE.md module rules).
 *
 * Wire payloads are retained verbatim for the raw payload capture (§65).
 */

export const providerSelectionSchema = z.object({
  /** Canonical outcome for the market family (e.g. HOME, OVER, BTTS_YES), or a
   *  family-supported free-form scoreline for EXACT_SCORE (e.g. "2-1"). */
  outcome: z.string().min(1, "outcome is required"),
  /** Provider-side raw outcome label, kept for audit (e.g. "Manchester City"). */
  providerOutcome: z.string().min(1, "providerOutcome is required"),
  odds: z.number().finite().gt(1.0, `odds must be greater than 1.0`),
  /** Canonical line as a decimal string when the market is line-bearing. */
  point: z.string().optional(),
  /** Provider-specific selection id when present in the wire payload. */
  providerSelectionId: z.string().optional(),
  /** Source-side price timestamp. MUST be <= the envelope receivedAt for a
   *  valid freshness record; converters clamp to receivedAt defensively. */
  sourceUpdatedAt: z.iso.datetime(),
});
export type ProviderSelection = z.infer<typeof providerSelectionSchema>;

export const providerPriceSchema = z.object({
  bookmakerKey: z.string().min(1, "bookmakerKey is required"),
  bookmakerTitle: z.string().optional(),
  /** Latest of the bookmaker/market last_update timestamps from the wire. */
  sourceUpdatedAt: z.iso.datetime(),
  selections: z.array(providerSelectionSchema).min(1, "a price group needs at least one selection"),
});
export type ProviderPrice = z.infer<typeof providerPriceSchema>;

export const providerMarketSchema = z.object({
  sourceMarketId: z.string().min(1, "sourceMarketId is required"),
  family: marketFamilySchema,
  marketType: z.string().min(1, "marketType is required"),
  period: periodSchema,
  participant: participantSchema.optional(),
  line: z.string().optional(),
  prices: z.array(providerPriceSchema).min(1, "a market needs at least one price group"),
});
export type ProviderMarket = z.infer<typeof providerMarketSchema>;

export const providerEventSchema = z.object({
  providerEventId: z.string().min(1, "providerEventId is required"),
  competition: z.string().min(1, "competition is required"),
  homeTeam: z.string().min(1, "homeTeam is required"),
  awayTeam: z.string().min(1, "awayTeam is required"),
  startTime: z.iso.datetime(),
  status: eventStatusSchema.default(EventStatus.SCHEDULED),
  markets: z.array(providerMarketSchema),
});
export type ProviderEvent = z.infer<typeof providerEventSchema>;

export const providerEnvelopeSchema = z.object({
  provider: providerKeySchema,
  requestId: z.string().min(1, "requestId is required"),
  /** UTC ISO timestamp of when the payload was ingested by 22_VOID. */
  receivedAt: z.iso.datetime(),
  /** Source-side collection timestamp when the provider exposes one. */
  sourceCollectedAt: z.iso.datetime().optional(),
  /** Outcomes the adapter could not map to a canonical outcome, for audit. */
  skippedOutcomes: z.array(z.string()).default([]),
  events: z.array(providerEventSchema),
});
export type ProviderEnvelope = z.infer<typeof providerEnvelopeSchema>;

/** Canonical market family instance. */
export const providerMarketCanonicalSchema = z.object({
  sourceMarketId: z.string().min(1),
  providerEventId: z.string().min(1),
  structure: z.object({
    family: marketFamilySchema,
    period: periodSchema,
    marketType: z.string().min(1),
    participant: participantSchema.optional(),
    line: z.string().optional(),
  }),
});
export type ProviderMarketCanonical = z.infer<typeof providerMarketCanonicalSchema>;

/** Adapter-level health record (Phase 12 surfaces this to the dashboard). */
export const providerHealthSchema = z.object({
  provider: providerKeySchema,
  reachable: z.boolean(),
  latencyMs: z.number().finite().nonnegative().optional(),
  error: z.string().optional(),
  checkedAt: z.iso.datetime(),
});
export type ProviderHealth = z.infer<typeof providerHealthSchema>;

export { EventStatus, MarketFamily, MarketType, Participant, Period };

/** Re-exported marker so envelope.ts ships the full provider taxonomy. */
export type MarketTypeValue = (typeof MarketType)[keyof typeof MarketType];
