import { describe, expect, it } from "vitest";
import { SettlementResult } from "@22void/domain";
import type { SettlementRule } from "./index.js";

describe("@22void/settlement skeleton", () => {
  it("references canonical settlement results", () => {
    const rule: SettlementRule = {
      ruleVersion: "0.0.0",
      evaluate: () => 0,
    };
    expect(rule.ruleVersion).toBe("0.0.0");
    expect(SettlementResult.HALF_WIN).toBe("HALF_WIN");
  });
});