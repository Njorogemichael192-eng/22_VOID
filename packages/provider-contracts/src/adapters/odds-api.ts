import { z } from "zod";

import { EventStatus } from "@22void/domain";

import { providerEnvelopeSchema } from "../envelope";
import type { ProviderEnvelope, ProviderHealth } from "../envelope";
import { buildRawPayload, newRequestId } from "../odds-provider";
import type { OddsProvider, PollRequest, PollResult } from "../odds-provider";
import { fetchJson, ProviderTransportError } from "../providers/http";
import { ODDS_API_MARKET_KEYS } from "../providers/keys";
import { translateProviderOdds } from "../providers/translate";
import type { WireEvent } from "../providers/translate";

/** Odds-API.io (the-odds-api.com) v4 wire shapes for the /odds endpoint. */
const wireOutcomeSchema = z.object({
  name: z.string(),
  price: z.number().finite(),
  point: z.number().optional(),
});
const wireMarketSchema = z.object({
  key: z.string(),
  last_update: z.string().optional(),
  outcomes: z.array(wireOutcomeSchema),
});
const wireBookmakerSchema = z.object({
  key: z.string(),
  title: z.string().optional(),
  last_update: z.string().optional(),
  markets: z.array(wireMarketSchema),
});
const wireEventSchema = z.object({
  id: z.string(),
  sport_key: z.string().optional(),
  sport_title: z.string().optional(),
  commence_time: z.string(),
  home_team: z.string(),
  away_team: z.string(),
  status: z.string().optional(),
  bookmakers: z.array(wireBookmakerSchema),
});

export interface OddsApiProviderConfig {
  apiKey: string;
  baseUrl?: string;
  /** Bookmaker region filter: us | us2 | uk | eu | au (comma list). */
  regions?: string;
  /** Comma list of featured market keys to request on the /odds endpoint. */
  markets?: string;
  /** Sport key used when poll() is called without a sportKey (default soccer EPL). */
  defaultSportKey?: string;
}

const DEFAULT_BASE_URL = "https://api.the-odds-api.com";
const DEFAULT_REGIONS = "uk,eu";
const DEFAULT_MARKETS = "h2h,totals";

function toStatus(status: string | undefined): EventStatus {
  switch (status) {
    case "live":
      return EventStatus.LIVE;
    case "completed":
      return EventStatus.FINISHED;
    case "postponed":
      return EventStatus.POSTPONED;
    case "cancelled":
      return EventStatus.CANCELLED;
    case "abandoned":
      return EventStatus.ABANDONED;
    case "scheduled":
      return EventStatus.SCHEDULED;
    default:
      return EventStatus.SCHEDULED;
  }
}

/**
 * Odds-API.io live adapter (initial provider — see docs/PROVIDER_EVALUATION.md).
 * Auth travels as ?apiKey= per their documented scheme; the key is captured at
 * construction and never logged. Provider-specific concerns stay in this file.
 */
export class OddsApiProvider implements OddsProvider {
  readonly providerKey = "odds-api" as const;

  constructor(private readonly config: OddsApiProviderConfig) {}

  private get baseUrl(): string {
    return this.config.baseUrl ?? DEFAULT_BASE_URL;
  }

  async poll(request?: PollRequest): Promise<PollResult> {
    const sportKey = request?.sportKey ?? this.config.defaultSportKey ?? "soccer_epl";
    const regions = request?.regions ?? this.config.regions ?? DEFAULT_REGIONS;
    const markets = request?.markets ?? this.config.markets ?? DEFAULT_MARKETS;
    const receivedAt = new Date().toISOString();
    const requestId = newRequestId();
    const url = `${this.baseUrl}/v4/sports/${encodeURIComponent(sportKey)}/odds?apiKey=${encodeURIComponent(
      this.config.apiKey
    )}&regions=${encodeURIComponent(regions)}&markets=${encodeURIComponent(markets)}&oddsFormat=decimal&dateFormat=iso`;

    let payload: unknown;
    try {
      payload = await fetchJson(url, { headers: { Accept: "application/json" } });
    } catch (error) {
      if (error instanceof ProviderTransportError) throw error;
      throw new ProviderTransportError(String(error));
    }

    const wireEvents: WireEvent[] = z.array(wireEventSchema).parse(payload);
    const translated = translateProviderOdds(
      wireEvents,
      ODDS_API_MARKET_KEYS,
      this.providerKey,
      requestId,
      receivedAt,
      (event) => event.sport_title ?? event.sport_key ?? "football",
      (event) => toStatus(event.status),
      undefined
    );

    const envelope = providerEnvelopeSchema.parse({
      provider: this.providerKey,
      requestId,
      receivedAt,
      skippedOutcomes: translated.skippedOutcomes,
      events: translated.events,
    } satisfies ProviderEnvelope);

    return {
      envelope,
      rawPayload: buildRawPayload(
        this.providerKey,
        receivedAt,
        payload,
        requestId,
        `/v4/sports/${sportKey}/odds`
      ),
    };
  }

  async health(): Promise<ProviderHealth> {
    const startedAt = performance.now();
    try {
      const payload = await fetchJson(
        `${this.baseUrl}/v4/sports?apiKey=${encodeURIComponent(this.config.apiKey)}`,
        { headers: { Accept: "application/json" } },
        10_000
      );
      return {
        provider: this.providerKey,
        reachable: Array.isArray(payload),
        latencyMs: performance.now() - startedAt,
        checkedAt: new Date().toISOString(),
      };
    } catch {
      return {
        provider: this.providerKey,
        reachable: false,
        latencyMs: performance.now() - startedAt,
        checkedAt: new Date().toISOString(),
      };
    }
  }
}
