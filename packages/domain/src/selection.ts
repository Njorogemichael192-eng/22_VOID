import { z } from "zod";

import { decimalOddsSchema } from "./decimal-odds";
import { marketStructureSchema } from "./market";
import { MarketFamily, SelectionOutcome } from "./value-sets";

const EXACT_SCORE_OUTCOME_REGEX = /^[0-9]+-[0-9]+$/;

/** Outcome values valid per market family (§5, §7, §9). */
export const OUTCOMES_BY_FAMILY: { readonly [Family in MarketFamily]: readonly string[] } = {
  [MarketFamily.MATCH_RESULT]: [
    SelectionOutcome.HOME,
    SelectionOutcome.DRAW,
    SelectionOutcome.AWAY,
  ],
  [MarketFamily.DOUBLE_CHANCE]: [
    SelectionOutcome.HOME_OR_DRAW,
    SelectionOutcome.AWAY_OR_DRAW,
    SelectionOutcome.HOME_OR_AWAY,
  ],
  [MarketFamily.MATCH_TOTAL]: [SelectionOutcome.OVER, SelectionOutcome.UNDER],
  [MarketFamily.ASIAN_TOTAL]: [SelectionOutcome.OVER, SelectionOutcome.UNDER],
  [MarketFamily.ASIAN_HANDICAP]: [SelectionOutcome.HOME, SelectionOutcome.AWAY],
  [MarketFamily.TEAM_TOTAL]: [SelectionOutcome.OVER, SelectionOutcome.UNDER],
  [MarketFamily.TEAM_ASIAN_TOTAL]: [SelectionOutcome.OVER, SelectionOutcome.UNDER],
  [MarketFamily.CORNERS]: [SelectionOutcome.OVER, SelectionOutcome.UNDER],
  [MarketFamily.CARDS]: [SelectionOutcome.OVER, SelectionOutcome.UNDER],
  [MarketFamily.BTTS]: [SelectionOutcome.BTTS_YES, SelectionOutcome.BTTS_NO],
  [MarketFamily.EXACT_SCORE]: [],
};

export function validOutcomesForFamily(family: MarketFamily): readonly string[] {
  return OUTCOMES_BY_FAMILY[family];
}

export function isValidOutcomeForFamily(outcome: string, family: MarketFamily): boolean {
  if (family === MarketFamily.EXACT_SCORE) {
    return EXACT_SCORE_OUTCOME_REGEX.test(outcome);
  }
  return OUTCOMES_BY_FAMILY[family].includes(outcome);
}

export const canonicalSelectionSchema = z
  .object({
    selectionId: z.string().min(1, "selectionId is required"),
    market: marketStructureSchema,
    bookmakerId: z.string().min(1, "bookmakerId is required"),
    oddsSourceId: z.string().min(1, "oddsSourceId is required"),
    outcome: z.string().min(1, "outcome is required"),
    odds: decimalOddsSchema,
    observedAt: z.iso.datetime(),
    sourceUpdatedAt: z.iso.datetime(),
  })
  .superRefine((selection, ctx) => {
    if (!isValidOutcomeForFamily(selection.outcome, selection.market.family)) {
      ctx.addIssue({
        code: "custom",
        path: ["outcome"],
        message: `outcome "${selection.outcome}" is not valid for family "${selection.market.family}"`,
      });
    }
    if (Date.parse(selection.observedAt) < Date.parse(selection.sourceUpdatedAt)) {
      ctx.addIssue({
        code: "custom",
        path: ["observedAt"],
        message: "observedAt must not be before sourceUpdatedAt",
      });
    }
  });
export type CanonicalSelection = z.infer<typeof canonicalSelectionSchema>;
