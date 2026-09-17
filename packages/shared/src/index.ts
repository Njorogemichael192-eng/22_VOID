import { z } from "zod";

/**
 * Minimum decimal odds accepted by the engine.
 * Odds <= 1.0 are rejected by the odds sanity check (see ARBITRAGE_ENGINE_SPEC §5).
 */
export const MIN_DECIMAL_ODDS = 1.0;

/**
 * Shared round-to-step math helper. Used by the stake optimizer's execution layer
 * to round stakes to bookmaker increments (see ARBITRAGE_ENGINE_SPEC §36).
 * Returns the nearest multiple of `step` to `value`.
 */
export function roundToStep(value: number, step: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) {
    throw new Error("roundToStep requires a finite value and a positive step");
  }
  return Math.round(value / step) * step;
}

/** True when `odds` is a finite decimal odds value strictly greater than MIN_DECIMAL_ODDS. */
export function isValidDecimalOdds(odds: unknown): odds is number {
  return typeof odds === "number" && Number.isFinite(odds) && odds > MIN_DECIMAL_ODDS;
}

/** Current UTC time as an ISO-8601 string. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Zod schema validating decimal odds (finite, > MIN_DECIMAL_ODDS). */
export const decimalOddsSchema = z.number().finite().gt(MIN_DECIMAL_ODDS);

/** Zod schema validating a non-negative finite number (stakes, returns). */
export const nonNegativeNumberSchema = z.number().finite().nonnegative();

/** Zod schema validating a strictly positive finite number (total stake). */
export const positiveNumberSchema = z.number().finite().positive();