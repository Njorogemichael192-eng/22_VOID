import { z } from "zod";

import { EventStatus } from "@22void/domain";

import { providerEnvelopeSchema } from "../envelope";
import type { ProviderEnvelope, ProviderHealth } from "../envelope";
import { buildRawPayload, newRequestId } from "../odds-provider";
import type { OddsProvider, PollRequest, PollResult } from "../odds-provider";
import { fetchJson, ProviderTransportError } from "../providers/http";
import { PARLAY_API_MARKET_KEYS } from "../providers/keys";
import { translateProviderOdds } from "../providers/translate";
import type { WireEvent } from "../providers/translate";

/**
 * ParlayAPI v1 wire shapes for /v1/sports/{sport}/odds. Shape mirrors the
 * event -> bookmakers -> markets -> outcomes envelope. Status is carried as an
 * event-level "status" string when present.
 */
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

export interface ParlayApiProviderConfig {
  apiKey: string;
  baseUrl?: string;
  regions?: string;
  markets?: string;
  defaultSportKey?: string;
}

const DEFAULT_BASE_URL = "https://parlay-api.com";
const DEFAULT_REGIONS = "us";
const DEFAULT_MARKETS = "h2h_3_way,totals";

/** ParlayAPI health endpoint is the meta/markets catalog. */
const HEALTH_ENDPOINT = "/v1/meta/markets";

function toStatus(status: string | undefined): EventStatus {
  switch (status) {
    case "live":
      return EventStatus.LIVE;
    case "completed":
    case "final":
      return EventStatus.FINISHED;
    case "postponed":
      return EventStatus.POSTPONED;
    case "cancelled":
      return EventStatus.CANCELLED;
    case "abandoned":
      return EventStatus.ABANDONED;
    default:
      return EventStatus.SCHEDULED;
  }
}

/**
 * ParlayAPI adapter. NOT the initial provider (see PROVIDER_EVALUATION.md):
 * its soccer catalogue is h2h/totals/team_totals/btts/correct_score/double
 * chance with no documented corners, cards or Asian lines, and its free tier
 * is restricted to non-commercial use. Implemented to the same OddsProvider
 * contract so it can be enabled as Provider B in Phase 19 without core-engine
 * changes.
 */
export class ParlayApiProvider implements OddsProvider {
  readonly providerKey = "parlay-api" as const;

  constructor(private readonly config: ParlayApiProviderConfig) {}

  private get baseUrl(): string {
    return this.config.baseUrl ?? DEFAULT_BASE_URL;
  }

  async poll(request?: PollRequest): Promise<PollResult> {
    const sportKey = request?.sportKey ?? this.config.defaultSportKey ?? "soccer_epl";
    const regions = request?.regions ?? this.config.regions ?? DEFAULT_REGIONS;
    const markets = request?.markets ?? this.config.markets ?? DEFAULT_MARKETS;
    const receivedAt = new Date().toISOString();
    const requestId = newRequestId();
    const url = `${this.baseUrl}/v1/sports/${encodeURIComponent(
      sportKey
    )}/odds?regions=${encodeURIComponent(regions)}&markets=${encodeURIComponent(
      markets
    )}&include_live=false`;

    let payload: unknown;
    try {
      payload = await fetchJson(url, {
        headers: { Accept: "application/json", "X-API-Key": this.config.apiKey },
      });
    } catch (error) {
      if (error instanceof ProviderTransportError) throw error;
      throw new ProviderTransportError(String(error));
    }

    const wireEvents: WireEvent[] = z.array(wireEventSchema).parse(payload);
    const translated = translateProviderOdds(
      wireEvents,
      PARLAY_API_MARKET_KEYS,
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
        `/v1/sports/${sportKey}/odds`
      ),
    };
  }

  async health(): Promise<ProviderHealth> {
    const startedAt = performance.now();
    try {
      await fetchJson(`${this.baseUrl}${HEALTH_ENDPOINT}`, {
        headers: { Accept: "application/json", "X-API-Key": this.config.apiKey },
      });
      return {
        provider: this.providerKey,
        reachable: true,
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
