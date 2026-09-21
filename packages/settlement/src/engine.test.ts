import { describe, expect, it } from "vitest";

import { EventStatus, MarketFamily, MarketType, Period, SettlementResult } from "@22void/domain";

import { SettlementEngine, SettlementRuleStore, standardSettlementRule } from "./engine";
import type { SettlementRule } from "./engine";
import type { MatchState, SettleableSelection } from "./settle";

function unusedSelection(): SettleableSelection {
  return {
    family: MarketFamily.MATCH_TOTAL,
    marketType: MarketType.STANDARD,
    period: Period.FULL_MATCH,
    line: "2.5",
    outcome: "OVER",
  };
}

function finishedMatch(overrides: Partial<MatchState> = {}): MatchState {
  return {
    status: EventStatus.FINISHED,
    fullTime: { home: 3, away: 0 },
    firstHalf: null,
    secondHalf: null,
    extraTime: null,
    penalties: null,
    corners: null,
    cards: null,
    ...overrides,
  };
}

describe("SettlementEngine", () => {
  it("settles with the seeded standard rule", () => {
    const engine = new SettlementEngine();
    const verdict = engine.settle("std", unusedSelection(), finishedMatch());
    expect(verdict.kind).toBe("settled");
    if (verdict.kind === "settled") {
      expect(verdict.rule.ruleVersion).toBe("1");
      expect(verdict.rule.provider).toBe("std");
      expect(verdict.assessment.state.result).toBe(SettlementResult.FULL_WIN);
    }
  });

  it("reports UNKNOWN_SETTLEMENT when no rule applies", () => {
    const engine = new SettlementEngine();
    const verdict = engine.settle("odds-api", unusedSelection(), finishedMatch());
    expect(verdict.kind).toBe("unknown");
    if (verdict.kind === "unknown") {
      expect(verdict.reason).toContain("UNKNOWN_SETTLEMENT");
      expect(verdict.reason).toContain("odds-api");
    }
  });

  it("attaches the rule to an unknown verdict from within a known rule", () => {
    const engine = new SettlementEngine();
    const verdict = engine.settle(
      "std",
      unusedSelection(),
      finishedMatch({ status: EventStatus.SCHEDULED })
    );
    expect(verdict.kind).toBe("unknown");
    if (verdict.kind === "unknown") {
      expect(verdict.rule?.ruleVersion).toBe("1");
      expect(verdict.reason).toContain("not finished");
    }
  });
});

describe("SettlementRuleStore versioning (§53)", () => {
  function windowedRule(
    version: string,
    from: string,
    to: string | undefined,
    settle: SettlementRule["settle"]
  ): SettlementRule {
    return {
      provider: "odds-api",
      ruleVersion: version,
      effectiveFrom: from,
      ...(to !== undefined ? { effectiveTo: to } : {}),
      sourceReference: `test ref ${version}`,
      settle,
    };
  }

  it("picks the rule active at the given instant", () => {
    const store = new SettlementRuleStore();
    const voidRule: SettlementRule["settle"] = () => ({
      kind: "settled",
      assessment: { state: { result: SettlementResult.VOID, components: ["VOID"] }, notes: [] },
    });
    store.register(
      windowedRule("1", "2026-01-01T00:00:00Z", "2026-07-01T00:00:00Z", () => ({
        kind: "settled",
        assessment: {
          state: { result: SettlementResult.FULL_WIN, components: ["WIN"] },
          notes: [],
        },
      }))
    );
    store.register(windowedRule("2", "2026-07-01T00:00:00Z", undefined, voidRule));

    const engine = new SettlementEngine(store, { seedStandard: true });
    const atV1 = Date.parse("2026-03-15T00:00:00Z");
    const atV2 = Date.parse("2026-09-01T00:00:00Z");
    const before = Date.parse("2025-12-01T00:00:00Z");

    const v1 = engine.settle("odds-api", unusedSelection(), finishedMatch(), atV1);
    expect(v1.kind).toBe("settled");
    if (v1.kind === "settled") expect(v1.rule.ruleVersion).toBe("1");

    const v2 = engine.settle("odds-api", unusedSelection(), finishedMatch(), atV2);
    expect(v2.kind).toBe("settled");
    if (v2.kind === "settled") {
      expect(v2.rule.ruleVersion).toBe("2");
      expect(v2.assessment.state.result).toBe(SettlementResult.VOID);
    }

    const none = engine.settle("odds-api", unusedSelection(), finishedMatch(), before);
    expect(none.kind).toBe("unknown");
  });

  it("applies a newer rule version to new data and the older one to history (§53)", () => {
    const store = new SettlementRuleStore();
    store.register(standardSettlementRule("odds-api", "1", "spec"));
    store.register({
      provider: "odds-api",
      ruleVersion: "2",
      effectiveFrom: "2026-07-01T00:00:00Z",
      sourceReference: "provider rule update 2026-07",
      settle: () => ({
        kind: "settled",
        assessment: { state: { result: SettlementResult.PUSH, components: ["PUSH"] }, notes: [] },
      }),
    });

    const engine = new SettlementEngine(store, { seedStandard: false });
    const historical = engine.settle(
      "odds-api",
      unusedSelection(),
      finishedMatch(),
      Date.parse("2026-06-01T00:00:00Z")
    );
    const current = engine.settle(
      "odds-api",
      unusedSelection(),
      finishedMatch(),
      Date.parse("2026-08-01T00:00:00Z")
    );
    expect(historical.kind).toBe("settled");
    expect(current.kind).toBe("settled");
    if (historical.kind === "settled" && current.kind === "settled") {
      expect(historical.rule.ruleVersion).toBe("1");
      expect(historical.assessment.state.result).toBe(SettlementResult.FULL_WIN);
      expect(current.rule.ruleVersion).toBe("2");
      expect(current.assessment.state.result).toBe(SettlementResult.PUSH);
    }
  });

  it("rejects duplicate provider+version registrations", () => {
    const store = new SettlementRuleStore();
    store.register(standardSettlementRule("std", "1"));
    expect(() => store.register(standardSettlementRule("std", "1"))).toThrow(/already registered/);
  });

  it("lists known providers", () => {
    const store = new SettlementRuleStore();
    store.register(standardSettlementRule("odds-api", "1"));
    store.register(standardSettlementRule("parlay-api", "1"));
    expect(store.providers().sort()).toEqual(["odds-api", "parlay-api"]);
  });
});
