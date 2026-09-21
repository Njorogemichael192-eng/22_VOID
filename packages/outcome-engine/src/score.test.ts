import { describe, expect, it } from "vitest";
import { goalMargin, matchTotal, metricTotal } from "./score.js";

describe("football score primitives", () => {
  it("computes match total", () => {
    expect(matchTotal({ homeGoals: 2, awayGoals: 1 })).toBe(3);
  });

  it("computes goal margin", () => {
    expect(goalMargin({ homeGoals: 2, awayGoals: 1 })).toBe(1);
  });

  it("computes a count total", () => {
    expect(metricTotal({ home: 6, away: 5 })).toBe(11);
  });
});
