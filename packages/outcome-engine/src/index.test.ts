import { describe, expect, it } from "vitest";

import * as engine from "./index.js";

describe("@22void/outcome-engine export surface", () => {
  it("exposes the score and state-model API", () => {
    expect(typeof engine.matchTotal).toBe("function");
    expect(typeof engine.goalMargin).toBe("function");
    expect(typeof engine.metricTotal).toBe("function");
    expect(typeof engine.boundaryMax).toBe("function");
    expect(typeof engine.buildStateModel).toBe("function");
    expect(typeof engine.settleVector).toBe("function");
    expect(typeof engine.settlementMatrix).toBe("function");
    expect(typeof engine.payoffMatrix).toBe("function");
  });

  it("builds a state model end to end", () => {
    const { states } = engine.buildStateModel([
      {
        family: "MATCH_TOTAL",
        marketType: "STANDARD",
        period: "FULL_MATCH",
        line: "2.5",
        outcome: "OVER",
      },
    ]);
    expect(states.length).toBeGreaterThan(0);
  });
});
