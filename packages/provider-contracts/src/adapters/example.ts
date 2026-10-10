import { z } from "zod";

import { EventStatus } from "@22void/domain";

import { providerEnvelopeSchema } from "../envelope";
import type { ProviderEnvelope, ProviderHealth } from "../envelope";
import { buildRawPayload, newRequestId } from "../odds-provider";
import type { OddsProvider, PollRequest, PollResult } from "../odds-provider";
import { fetchJson, ProviderTransportError } from "../providers/http";
import { EXAMPLE_MARKET_KEYS } from "../providers/keys";
import { translateProviderOdds } from "../providers/translate";
import type { WireEvent } from "../providers/translate";

/**
 * Reference provider adapter — the worked example for docs/ADDING_A_PROVIDER.md.
 *
 * A new provider is added by copying this file's shape: a zod wire schema, an
 * endpoint, and a call into the shared `translateProviderOdds` pipeline with the
 * provider's own market-key registry. Nothing here touches the core engine
 * (`@22void/arbitrage`, `@22void/db`, `apps/`) — multi-provider polling in the
 * worker is what makes an added provider available without an engine rewrite.
 *
 * Credential-free on purpose: it carries no API key so the template can be
 * exercised end-to-end (config → adapter → canonical records) at zero provider
 * credits. It polls a generic event→bookmaker→market→outcome document from a
 * configurable base URL, so it can be pointed at a local fixture server in
 * tests. It is refused in production (see workers/odds-collector config.ts):
 * a reference adapter is for development, not a real feed.
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

export interface ExampleProviderConfig {
  /** Base URL of the feed; the adapter appends `/odds` and `/health`. */
  readonly baseUrl: string;
  readonly regions?: string;
  readonly markets?: string;
  readonly defaultSportKey?: string;
}

const DEFAULT_REGIONS = "uk";
const DEFAULT_MARKETS = "h2h,totals";
const DEFAULT_SPORT_KEY = "soccer_epl";

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

export class ExampleProvider implements OddsProvider {
  readonly providerKey = "example" as const;

  constructor(private readonly config: ExampleProviderConfig) {}

  async poll(request?: PollRequest): Promise<PollResult> {
    const sportKey = request?.sportKey ?? this.config.defaultSportKey ?? DEFAULT_SPORT_KEY;
    const regions = request?.regions ?? this.config.regions ?? DEFAULT_REGIONS;
    const markets = request?.markets ?? this.config.markets ?? DEFAULT_MARKETS;
    const receivedAt = new Date().toISOString();
    const requestId = newRequestId();
    const path = `/odds?sport=${encodeURIComponent(
      sportKey
    )}&regions=${encodeURIComponent(regions)}&markets=${encodeURIComponent(markets)}`;

    let payload: unknown;
    try {
      payload = await fetchJson(`${this.config.baseUrl}${path}`, {
        headers: { Accept: "application/json" },
      });
    } catch (error) {
      if (error instanceof ProviderTransportError) throw error;
      throw new ProviderTransportError(String(error));
    }

    const wireEvents: WireEvent[] = z.array(wireEventSchema).parse(payload);
    const translated = translateProviderOdds(
      wireEvents,
      EXAMPLE_MARKET_KEYS,
      this.providerKey,
      requestId,
      receivedAt,
      (event) => event.sport_title ?? event.sport_key ?? "football",
      (event) => toStatus(event.status)
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
        `/odds?sport=${sportKey}`
      ),
    };
  }

  async health(): Promise<ProviderHealth> {
    const startedAt = performance.now();
    try {
      await fetchJson(`${this.config.baseUrl}/health`, { headers: { Accept: "application/json" } });
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
