import { describe, expect, it } from "vitest";
import { planMarketReconcile } from "./market-reconcile";
import type { ReconcileMarketRef } from "./market-reconcile";

/**
 * Phase 19 Step 5 — cross-provider market reconciliation planner.
 *
 * Pure: given persisted markets it computes a deterministic within-event fold
 * plan without touching a database. Identical structures fold; the winner is
 * chosen by provider priority, then creation time, then market id.
 */

function market(
  marketId: string,
  canonicalEventId: string,
  provider: string,
  overrides: Partial<ReconcileMarketRef> = {}
): ReconcileMarketRef {
  return {
    marketId,
    canonicalEventId,
    provider,
    sourceMarketId: `${canonicalEventId}:${marketId}`,
    family: "MATCH_TOTAL",
    period: "FULL_MATCH",
    marketType: "STANDARD",
    line: "2.5",
    createdAt: "2026-10-06T18:08:26.347Z",
    ...overrides,
  };
}

const EVENT = "odds-api:evt-1";

describe("planMarketReconcile", () => {
  it("folds a cross-provider duplicate onto the higher-priority provider", () => {
    const parlay = market("mkt-parlay", EVENT, "parlay-api", {
      createdAt: "2026-10-05T00:00:00.000Z",
    });
    const odds = market("mkt-odds", EVENT, "odds-api", {
      createdAt: "2026-10-06T00:00:00.000Z",
    });

    const plan = planMarketReconcile([parlay, odds]);

    expect(plan.merges).toHaveLength(1);
    expect(plan.merges[0]).toMatchObject({
      winnerMarketId: "mkt-odds",
      loserMarketId: "mkt-parlay",
      winnerProvider: "odds-api",
      loserProvider: "parlay-api",
      canonicalEventId: EVENT,
      canonicalMarketId: "MATCH_TOTAL|FULL_MATCH|STANDARD|_|2.5",
    });
    expect(plan.standalone).toEqual([]);
  });

  it("is stable under input permutation", () => {
    const a = market("mkt-a", EVENT, "odds-api");
    const b = market("mkt-b", EVENT, "parlay-api");
    const forward = planMarketReconcile([a, b]);
    const reverse = planMarketReconcile([b, a]);
    expect(forward).toEqual(reverse);
  });

  it("never folds different structures together", () => {
    const total = market("mkt-total", EVENT, "odds-api", { line: "2.5" });
    const otherLine = market("mkt-total-3", EVENT, "parlay-api", { line: "3.5" });
    const result = market("mkt-result", EVENT, "parlay-api", {
      family: "MATCH_RESULT",
      marketType: "1X2",
      line: null,
    });

    const plan = planMarketReconcile([total, otherLine, result]);

    expect(plan.merges).toEqual([]);
    expect(plan.standalone.sort()).toEqual(["mkt-result", "mkt-total", "mkt-total-3"]);
  });

  it("never folds the same structure from different events", () => {
    const a = market("mkt-a", "odds-api:evt-1", "odds-api");
    const b = market("mkt-b", "parlay-api:evt-2", "parlay-api");
    const plan = planMarketReconcile([a, b]);
    expect(plan.merges).toEqual([]);
    expect(plan.standalone.sort()).toEqual(["mkt-a", "mkt-b"]);
  });

  it("breaks a same-priority tie by creation time, then market id", () => {
    const older = market("mkt-old", EVENT, "mock", { createdAt: "2026-01-01T00:00:00.000Z" });
    const newer = market("mkt-new", EVENT, "mock", { createdAt: "2026-02-01T00:00:00.000Z" });
    const plan = planMarketReconcile([newer, older]);
    expect(plan.merges[0]).toMatchObject({
      winnerMarketId: "mkt-old",
      loserMarketId: "mkt-new",
    });
  });

  it("folds three colliding markets onto one winner", () => {
    const odds = market("mkt-odds", EVENT, "odds-api");
    const parlay = market("mkt-parlay", EVENT, "parlay-api");
    const mock = market("mkt-mock", EVENT, "mock");

    const plan = planMarketReconcile([mock, parlay, odds]);

    expect(plan.merges).toHaveLength(2);
    expect(plan.merges.every((merge) => merge.winnerMarketId === "mkt-odds")).toBe(true);
    expect(plan.merges.map((merge) => merge.loserMarketId).sort()).toEqual([
      "mkt-mock",
      "mkt-parlay",
    ]);
    expect(plan.standalone).toEqual([]);
  });

  it("treats a single market as standalone", () => {
    const plan = planMarketReconcile([market("mkt-only", EVENT, "odds-api")]);
    expect(plan.merges).toEqual([]);
    expect(plan.standalone).toEqual(["mkt-only"]);
  });
});
