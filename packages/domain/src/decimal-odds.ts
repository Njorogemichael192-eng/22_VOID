import { MIN_DECIMAL_ODDS } from "@22void/shared";
import { z } from "zod";
/** Fire-and-forget branded type for a validated decimal odds value.
 *
 * Construction is only possible through `decimalOddsSchema`/`parseDecimalOdds`
 * so invalid prices (<= 1.0, NaN, Infinity) cannot exist in typed paths.
 */
export type DecimalOdds = number & { readonly __brand: "DecimalOdds" };

export const decimalOddsSchema = z
  .number()
  .finite("odds must be a finite number")
  .gt(MIN_DECIMAL_ODDS, `odds must be greater than ${MIN_DECIMAL_ODDS}`)
  .transform((value): DecimalOdds => value as DecimalOdds);

export function parseDecimalOdds(value: unknown): DecimalOdds {
  return decimalOddsSchema.parse(value);
}
