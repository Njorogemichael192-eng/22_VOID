import { describe, expect, it } from "vitest";
import { goalMargin, matchTotal } from "./index.js";

describe("@22void/outcome-engine skeleton", () => {
  it("computes match total", () => {
    expect(matchTotal({ homeGoals: 2, awayGoals: 1 })).toBe(3);
  });

  it("computes goal margin", () => {
    expect(goalMargin({ homeGoals: 2, awayGoals: 1 })).toBe(1);
  });
});