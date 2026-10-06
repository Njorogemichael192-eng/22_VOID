import { z } from "zod";

import { EventStatus } from "@22void/domain";

import { providerEnvelopeSchema } from "../envelope";
import type { ProviderEnvelope, ProviderHealth } from "../envelope";
import { buildRawPayload, newRequestId } from "../odds-provider";
import type { OddsProvider, PollRequest, PollResult } from "../odds-provider";
import { fetchJson, ProviderTransportError } from "../providers/http";
import type { ProviderQuota, ProviderResponseMeta } from "../providers/http";
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
  /**
   * Escape hatch: send the key as `?apiKey=` instead of the `x-api-key` header.
   *
   * Off by default and should stay off. A credential in the query string is
   * copied verbatim into every proxy, CDN and load-balancer access log between
   * this process and the provider, and into any log line that echoes the request
   * URL — the header is not. Set this only if the provider rejects header auth,
   * and expect a 401 to say so if you forget. The key is never logged either way.
   */
  authInQuery?: boolean;
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
 *
 * Auth travels as the `x-api-key` header, matching the ParlayAPI adapter in this
 * package. It used to travel as `?apiKey=`, which put a live provider credential
 * in the query string of every request: copied into each proxy and CDN access
 * log along the path, and into any error message that echoed the URL. The key is
 * captured at construction, sent only as a header, and never logged — see
 * `authInQuery` for the documented compatibility escape hatch.
 * Provider-specific concerns stay in this file.
 */
export class OddsApiProvider implements OddsProvider {
  readonly providerKey = "odds-api" as const;

  /**
   * Balance from the most recent HTTP response to this provider.
   *
   * Mutated from the `onMeta` callback inside `poll`/`health`, so it reflects the
   * newest response this instance has seen - including a failed one, which is
   * the reading that matters when the cycle goes DOWN.
   */
  private lastQuota: ProviderQuota | undefined;

  constructor(private readonly config: OddsApiProviderConfig) {}

  /** See `OddsProvider.quotaSnapshot`. */
  quotaSnapshot(): ProviderQuota | undefined {
    return this.lastQuota;
  }

  /**
   * Record quota headers. Bound per call so it can be handed straight to
   * `fetchJson`, which invokes it on both the success and the error path.
   */
  private captureMeta = (meta: ProviderResponseMeta): void => {
    if (meta.quota !== undefined) this.lastQuota = meta.quota;
  };

  private get baseUrl(): string {
    return this.config.baseUrl ?? DEFAULT_BASE_URL;
  }

  /** Header form by default; the query parameter only when explicitly opted in. */
  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.config.authInQuery !== true) headers["x-api-key"] = this.config.apiKey;
    return headers;
  }

  private withQueryAuth(url: string): string {
    if (this.config.authInQuery !== true) return url;
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}apiKey=${encodeURIComponent(this.config.apiKey)}`;
  }

  /**
   * A 401/403 while sending the header is the one case where the operator needs
   * the escape hatch named at them, because the cause is otherwise opaque: the
   * key may simply be wrong. Only the status is added; the URL stays redacted
   * inside `fetchJson`.
   */
  private rethrow(error: unknown): never {
    if (
      error instanceof ProviderTransportError &&
      (error.status === 401 || error.status === 403) &&
      this.config.authInQuery !== true
    ) {
      throw new ProviderTransportError(
        `${error.message} — if this provider does not accept x-api-key, set ` +
          "authInQuery (ODDS_API_AUTH_IN_QUERY) to send the key as ?apiKey= instead.",
        { status: error.status }
      );
    }
    if (error instanceof ProviderTransportError) throw error;
    throw new ProviderTransportError(String(error));
  }

  async poll(request?: PollRequest): Promise<PollResult> {
    const sportKey = request?.sportKey ?? this.config.defaultSportKey ?? "soccer_epl";
    const regions = request?.regions ?? this.config.regions ?? DEFAULT_REGIONS;
    const markets = request?.markets ?? this.config.markets ?? DEFAULT_MARKETS;
    const receivedAt = new Date().toISOString();
    const requestId = newRequestId();
    const url = this.withQueryAuth(
      `${this.baseUrl}/v4/sports/${encodeURIComponent(sportKey)}/odds?regions=${encodeURIComponent(
        regions
      )}&markets=${encodeURIComponent(markets)}&oddsFormat=decimal&dateFormat=iso`
    );

    let payload: unknown;
    try {
      payload = await fetchJson(url, { headers: this.authHeaders() }, undefined, this.captureMeta);
    } catch (error) {
      this.rethrow(error);
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
        this.withQueryAuth(`${this.baseUrl}/v4/sports`),
        { headers: this.authHeaders() },
        10_000,
        // /v4/sports is documented as not quota-billed, but it still reports the
        // headers, so this keeps the snapshot fresh without spending a credit.
        this.captureMeta
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
