import { z } from "zod";

import { MarketFamily, marketFamilySchema, participantSchema, periodSchema } from "./value-sets";

/** Canonical market type within a family (§4.2, §7). */
export const MarketType = {
  ONE_X_TWO: "1X2",
  DOUBLE_CHANCE: "DOUBLE_CHANCE",
  STANDARD: "STANDARD",
  ASIAN: "ASIAN",
  HANDICAP: "HANDICAP",
  BTTS: "BTTS",
  EXACT_SCORE: "EXACT_SCORE",
} as const;
export type MarketType = (typeof MarketType)[keyof typeof MarketType];

/** A market line expressed canonically as a decimal string (e.g. "2.5", "-0.75"). */
const lineSchema = z
  .string()
  .regex(/^-?[0-9]+(?:\.[0-9]+)?$/, "line must be a canonical decimal string")
  .refine((line) => Number.isFinite(Number(line)), "line must be a finite number");

export interface MarketFamilySpec {
  readonly allowedMarketTypes: readonly MarketType[];
  readonly requiresParticipant: boolean;
  readonly requiresLine: boolean;
}

/**
 * Per-family market structure invariants (§7). A market is only canonical when
 * its type, participant and line shape match its family.
 */
export const MARKET_STRUCTURES: { readonly [Family in MarketFamily]: MarketFamilySpec } = {
  [MarketFamily.MATCH_RESULT]: {
    allowedMarketTypes: [MarketType.ONE_X_TWO],
    requiresParticipant: false,
    requiresLine: false,
  },
  [MarketFamily.DOUBLE_CHANCE]: {
    allowedMarketTypes: [MarketType.DOUBLE_CHANCE],
    requiresParticipant: false,
    requiresLine: false,
  },
  [MarketFamily.MATCH_TOTAL]: {
    allowedMarketTypes: [MarketType.STANDARD],
    requiresParticipant: false,
    requiresLine: true,
  },
  [MarketFamily.ASIAN_TOTAL]: {
    allowedMarketTypes: [MarketType.ASIAN],
    requiresParticipant: false,
    requiresLine: true,
  },
  [MarketFamily.ASIAN_HANDICAP]: {
    allowedMarketTypes: [MarketType.HANDICAP],
    requiresParticipant: true,
    requiresLine: true,
  },
  [MarketFamily.TEAM_TOTAL]: {
    allowedMarketTypes: [MarketType.STANDARD],
    requiresParticipant: true,
    requiresLine: true,
  },
  [MarketFamily.TEAM_ASIAN_TOTAL]: {
    allowedMarketTypes: [MarketType.ASIAN],
    requiresParticipant: true,
    requiresLine: true,
  },
  [MarketFamily.CORNERS]: {
    allowedMarketTypes: [MarketType.STANDARD],
    requiresParticipant: false,
    requiresLine: true,
  },
  [MarketFamily.CARDS]: {
    allowedMarketTypes: [MarketType.STANDARD],
    requiresParticipant: false,
    requiresLine: true,
  },
  [MarketFamily.BTTS]: {
    allowedMarketTypes: [MarketType.BTTS],
    requiresParticipant: false,
    requiresLine: false,
  },
  [MarketFamily.EXACT_SCORE]: {
    allowedMarketTypes: [MarketType.EXACT_SCORE],
    requiresParticipant: false,
    requiresLine: false,
  },
};

const baseMarketStructureSchema = z.object({
  family: marketFamilySchema,
  period: periodSchema,
  marketType: z.string().min(1, "marketType is required"),
  participant: participantSchema.optional(),
  line: lineSchema.optional(),
});

export const marketStructureSchema = baseMarketStructureSchema.superRefine((market, ctx) => {
  const spec = MARKET_STRUCTURES[market.family];
  if (!spec.allowedMarketTypes.includes(market.marketType as MarketType)) {
    ctx.addIssue({
      code: "custom",
      path: ["marketType"],
      message: `marketType "${market.marketType}" is not valid for family "${market.family}"`,
    });
  }
  if (spec.requiresParticipant && market.participant === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["participant"],
      message: `family "${market.family}" requires a participant`,
    });
  }
  if (!spec.requiresParticipant && market.participant !== undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["participant"],
      message: `family "${market.family}" does not take a participant`,
    });
  }
  if (spec.requiresLine && market.line === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["line"],
      message: `family "${market.family}" requires a line`,
    });
  }
  if (!spec.requiresLine && market.line !== undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["line"],
      message: `family "${market.family}" does not take a line`,
    });
  }
});
export type MarketStructure = z.infer<typeof marketStructureSchema>;

/** Canonical within-event identity of a market structure (used for dedup/caching). */
export function marketStructureKey(
  market: Pick<MarketStructure, "family" | "period" | "marketType" | "participant" | "line">
): string {
  return [
    market.family,
    market.period,
    market.marketType,
    market.participant ?? "_",
    market.line ?? "_",
  ].join("|");
}
