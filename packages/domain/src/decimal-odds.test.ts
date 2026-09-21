import { describe, expect, it } from "vitest";

import { decimalOddsSchema, parseDecimalOdds, type DecimalOdds } from "./index.js";

describe("decimal odds representation", () => {
  it("accepts odds above the minimum", () => {
    const odds = parseDecimalOdds(2.05);
    expect(odds).toBe(2.05);
  });

  it("rejects odds at the minimum", () => {
    expect(decimalOddsSchema.safeParse(1).success).toBe(false);
  });

  it("rejects odds below the minimum", () => {
    expect(decimalOddsSchema.safeParse(0.95).success).toBe(false);
  });

  it("rejects non-finite and non-number inputs", () => {
    expect(decimalOddsSchema.safeParse(NaN).success).toBe(false);
    expect(decimalOddsSchema.safeParse(Infinity).success).toBe(false);
    expect(decimalOddsSchema.safeParse("2.05").success).toBe(false);
    expect(decimalOddsSchema.safeParse(null).success).toBe(false);
  });

  it("brands parsed values with the DecimalOdds type", () => {
    const odds = decimalOddsSchema.parse(3.75) as DecimalOdds;
    expect(typeof odds).toBe("number");
  });
});
