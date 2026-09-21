import { z } from "zod";

/** Registered data-provider keys. Adapters must stay behind these keys. */
export const PROVIDER_KEYS = ["mock", "odds-api", "parlay-api"] as const;
export type ProviderKey = (typeof PROVIDER_KEYS)[number];

export const providerKeySchema = z.enum(PROVIDER_KEYS);
