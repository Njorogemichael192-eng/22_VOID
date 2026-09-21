import { z } from "zod";

import { ScoreFreshness, scoreFreshnessSchema } from "./value-sets";

export interface FreshnessPolicy {
  /** age below this (ms) is FRESH */
  readonly freshMs: number;
  /** age below this (ms) is AGING; at/above is STALE */
  readonly agingMs: number;
}

/** Spec §38 example policy: <5s FRESH, 5–15s AGING, >15s STALE. */
export const DEFAULT_FRESHNESS_POLICY: FreshnessPolicy = {
  freshMs: 5_000,
  agingMs: 15_000,
} as const;

export function classifyFreshness(
  ageMs: number,
  policy: FreshnessPolicy = DEFAULT_FRESHNESS_POLICY
): ScoreFreshness {
  if (ageMs < policy.freshMs) return ScoreFreshness.FRESH;
  if (ageMs < policy.agingMs) return ScoreFreshness.AGING;
  return ScoreFreshness.STALE;
}

export interface Freshness {
  readonly sourceUpdatedAt: string;
  readonly ingestedAt: string;
  readonly ageMs: number;
  readonly score: ScoreFreshness;
}

export const freshnessSchema = z
  .object({
    sourceUpdatedAt: z.iso.datetime(),
    ingestedAt: z.iso.datetime(),
    ageMs: z.number().finite().min(0, "ageMs must be non-negative"),
    score: scoreFreshnessSchema,
  })
  .superRefine((freshness, ctx) => {
    if (classifyFreshness(freshness.ageMs) !== freshness.score) {
      ctx.addIssue({
        code: "custom",
        path: ["score"],
        message: `score "${freshness.score}" does not match classifyFreshness(${freshness.ageMs}ms)`,
      });
    }
  });
export type FreshnessView = z.infer<typeof freshnessSchema>;

/** Compute freshness state for a price: age = now - sourceUpdatedAt (§38). */
export function freshnessScore(
  sourceUpdatedAt: string,
  ingestedAt: string,
  now: Date = new Date(),
  policy: FreshnessPolicy = DEFAULT_FRESHNESS_POLICY
): Freshness {
  const ageMs = Math.max(0, Date.parse(now.toISOString()) - Date.parse(sourceUpdatedAt));
  return {
    sourceUpdatedAt,
    ingestedAt,
    ageMs,
    score: classifyFreshness(ageMs, policy),
  };
}
