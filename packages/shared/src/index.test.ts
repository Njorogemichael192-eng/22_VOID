import { describe, expect, it } from "vitest";
import {
  isValidDecimalOdds,
  MIN_DECIMAL_ODDS,
  nonNegativeNumberSchema,
  positiveNumberSchema,
  roundToStep,
} from "./index.js";

describe("isValidDecimalOdds", () => {
  it("accepts odds above the minimum", () => {
    expect(isValidDecimalOdds(1.5)).toBe(true);
    expect(isValidDecimalOdds(2.2)).toBe(true);
  });

  it("rejects odds at or below the minimum", () => {
    expect(isValidDecimalOdds(MIN_DECIMAL_ODDS)).toBe(false);
    expect(isValidDecimalOdds(0.5)).toBe(false);
  });

  it("rejects malformed inputs", () => {
    expect(isValidDecimalOdds(NaN)).toBe(false);
    expect(isValidDecimalOdds(Infinity)).toBe(false);
    expect(isValidDecimalOdds(null)).toBe(false);
    expect(isValidDecimalOdds("2.1")).toBe(false);
  });
});

describe("roundToStep", () => {
  it("rounds to the requested increment", () => {
    expect(roundToStep(1237.483, 1)).toBe(1237);
    expect(roundToStep(2762.517, 5)).toBe(2765);
    expect(roundToStep(100, 50)).toBe(100);
  });

  it("rejects invalid inputs", () => {
    expect(() => roundToStep(1, 0)).toThrow();
    expect(() => roundToStep(NaN, 5)).toThrow();
  });
});

describe("number schemas", () => {
  it("validates non-negative numbers", () => {
    expect(nonNegativeNumberSchema.safeParse(0).success).toBe(true);
    expect(nonNegativeNumberSchema.safeParse(-1).success).toBe(false);
  });

  it("validates positive numbers", () => {
    expect(positiveNumberSchema.safeParse(100).success).toBe(true);
    expect(positiveNumberSchema.safeParse(0).success).toBe(false);
  });
});