import { z } from "zod";

import { providerEnvelopeSchema } from "./envelope";
import type { ProviderHealth } from "./envelope";
import { providerKeySchema } from "./provider-id";
import type { ProviderKey } from "./provider-id";

/**
 * OddsProvider contract (BUILD_AGENT_PROMPT Phase 3).
 *
 * Provider-specific code must stay inside adapter implementations. The core
 * engine consumes only the normalized envelope and health record produced
 * here. See ARCHITECTURE.md module boundaries.
 */

export const pollRequestSchema = z.object({
  /** Provider sport key, e.g. "soccer_epl" / "soccer_fifa_world_cup". */
  sportKey: z.string().min(1).optional(),
  /** Comma list of regions/filters forwarded to providers that support them. */
  regions: z.string().optional(),
  /** Comma list of market keys the provider should return (provider-native). */
  markets: z.string().optional(),
});
export type PollRequest = z.infer<typeof pollRequestSchema>;

export const rawProviderPayloadSchema = z.object({
  provider: providerKeySchema,
  requestId: z.string().min(1),
  endpoint: z.string().optional(),
  /** Verbatim wire payload as received from the provider (§65 retention). */
  payload: z.unknown(),
  receivedAt: z.iso.datetime(),
});
export type RawProviderPayload = z.infer<typeof rawProviderPayloadSchema>;

export const pollResultSchema = z.object({
  /** Provider-normalized canonical envelope (validated against providerEnvelopeSchema). */
  envelope: providerEnvelopeSchema,
  /** Retention record for the raw wire payload. */
  rawPayload: rawProviderPayloadSchema,
});
export type PollResult = z.infer<typeof pollResultSchema>;

/** All providers must implement this interface. */
export interface OddsProvider {
  readonly providerKey: ProviderKey;
  /** Fetch the latest events and prices into a normalized envelope. */
  poll(request?: PollRequest): Promise<PollResult>;
  /** Lightweight reachability/latency probe for the scanner heartbeat. */
  health(): Promise<ProviderHealth>;
}

/** Creates a new request id for a capture run. */
export function newRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Builds a raw provider payload retention record around a wire payload. */
export function buildRawPayload(
  provider: ProviderKey,
  receivedAt: string,
  payload: unknown,
  requestId = newRequestId(),
  endpoint?: string
): RawProviderPayload {
  return {
    provider,
    requestId,
    endpoint,
    payload,
    receivedAt,
  };
}
