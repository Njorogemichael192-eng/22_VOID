import { describe, expect, it } from "vitest";

import * as arbitrage from "./index.js";

describe("@22void/arbitrage export surface", () => {
  it("exposes the false-arb detector API", () => {
    expect(typeof arbitrage.detectFalseArb).toBe("function");
    expect(typeof arbitrage.formatRejection).toBe("function");
    expect(typeof arbitrage.formatCoverageReport).toBe("function");
  });

  it("runs a simple covered candidate end to end", () => {
    const report = arbitrage.detectFalseArb([
      {
        id: "over",
        odds: 2.1,
        selection: {
          family: "MATCH_TOTAL",
          marketType: "STANDARD",
          period: "FULL_MATCH",
          line: "2.5",
          outcome: "OVER",
        },
      },
      {
        id: "under",
        odds: 2.1,
        selection: {
          family: "MATCH_TOTAL",
          marketType: "STANDARD",
          period: "FULL_MATCH",
          line: "2.5",
          outcome: "UNDER",
        },
      },
    ]);
    expect(report.status).toBe("COVERED");
  });
});
