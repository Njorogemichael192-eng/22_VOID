import { describe, expect, it } from "vitest";

import {
  componentPayouts,
  payout,
  SettlementEngine,
  SettlementRuleStore,
  settleSelection,
  splitAsianLine,
  standardSettlementRule,
  formatLine,
  lineKind,
  parseCanonicalLine,
  periodScore,
} from "./index";

describe("@22void/settlement export surface", () => {
  it("exposes the Phase 6 settlement modules", () => {
    expect(typeof settleSelection).toBe("function");
    expect(typeof periodScore).toBe("function");
    expect(typeof parseCanonicalLine).toBe("function");
    expect(typeof formatLine).toBe("function");
    expect(typeof lineKind).toBe("function");
    expect(typeof splitAsianLine).toBe("function");
    expect(typeof SettlementRuleStore).toBe("function");
    expect(typeof standardSettlementRule).toBe("function");
    expect(typeof SettlementEngine).toBe("function");
    expect(typeof payout).toBe("function");
    expect(typeof componentPayouts).toBe("function");
  });
});
