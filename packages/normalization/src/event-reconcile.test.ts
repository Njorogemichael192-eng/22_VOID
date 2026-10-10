import { describe, expect, it } from "vitest";

import { planEventReconcile } from "./event-reconcile";
import type { ReconcileEventRef } from "./event-reconcile";

/**
 * Cross-provider event reconciliation planner tests (Phase 19 Step 4).
 *
 * Pure: the planner consumes stored event refs and returns a deterministic fold
 * plan without touching a database.
 */

function event(
  canonicalEventId: string,
  provider: string,
  homeTeam: string,
  awayTeam: string,
  startTime: string,
  createdAt: string
): ReconcileEventRef {
  return {
    canonicalEventId,
    homeTeam,
    awayTeam,
    competition: "England - Premier League",
    startTime,
    createdAt,
    sources: [{ provider, sourceEventId: canonicalEventId.split(":")[1] ?? canonicalEventId }],
  };
}

const ARSENAL_LEEDS_ODDS = event(
  "odds-api:o1",
  "odds-api",
  "Arsenal",
  "Leeds United",
  "2026-10-10T11:30:00.000Z",
  "2026-10-06T18:08:26.347Z"
);
const ARSENAL_LEEDS_PARLAY = event(
  "parlay-api:p1",
  "parlay-api",
  "Arsenal",
  "Leeds United FC",
  "2026-10-10T11:30:00.000Z",
  "2026-10-06T21:01:08.411Z"
);

describe("planEventReconcile — folding", () => {
  it("folds a cross-provider duplicate into the priority winner", () => {
    const plan = planEventReconcile([ARSENAL_LEEDS_ODDS, ARSENAL_LEEDS_PARLAY]);
    expect(plan.merges).toHaveLength(1);
    const merge = plan.merges[0]!;
    expect(merge.winnerCanonicalEventId).toBe("odds-api:o1");
    expect(merge.loserCanonicalEventId).toBe("parlay-api:p1");
    expect(merge.winnerProvider).toBe("odds-api");
    expect(merge.loserProvider).toBe("parlay-api");
    expect(merge.score).toBe(1);
    expect(merge.sourceEventIds).toEqual([{ provider: "parlay-api", sourceEventId: "p1" }]);
  });

  it("keeps the winner stable regardless of input order", () => {
    const forward = planEventReconcile([ARSENAL_LEEDS_ODDS, ARSENAL_LEEDS_PARLAY]);
    const reversed = planEventReconcile([ARSENAL_LEEDS_PARLAY, ARSENAL_LEEDS_ODDS]);
    expect(reversed.merges).toEqual(forward.merges);
  });

  it("folds many providers onto a single winner", () => {
    const third = event(
      "three-api:t1",
      "three-api",
      "Arsenal",
      "Leeds United FC",
      "2026-10-10T11:30:00.000Z",
      "2026-10-06T22:00:00.000Z"
    );
    const plan = planEventReconcile([ARSENAL_LEEDS_ODDS, ARSENAL_LEEDS_PARLAY, third]);
    expect(plan.merges).toHaveLength(2);
    expect(plan.merges.every((m) => m.winnerCanonicalEventId === "odds-api:o1")).toBe(true);
  });
});

describe("planEventReconcile — safety rails", () => {
  it("never folds two events from the same provider", () => {
    const a = event(
      "odds-api:a",
      "odds-api",
      "Arsenal",
      "Leeds United",
      "2026-10-10T11:30:00.000Z",
      "2026-10-06T18:00:00.000Z"
    );
    const b = event(
      "odds-api:b",
      "odds-api",
      "Arsenal",
      "Leeds United",
      "2026-10-10T11:30:00.000Z",
      "2026-10-06T19:00:00.000Z"
    );
    const plan = planEventReconcile([a, b]);
    expect(plan.merges).toHaveLength(0);
    expect(plan.standalone).toEqual(["odds-api:a", "odds-api:b"]);
  });

  it("does not fold different clubs with similar canonical names", () => {
    const manUtd = event(
      "odds-api:mu",
      "odds-api",
      "Manchester United",
      "Arsenal",
      "2026-10-10T11:30:00.000Z",
      "2026-10-06T18:00:00.000Z"
    );
    const manCity = event(
      "parlay-api:mc",
      "parlay-api",
      "Manchester City FC",
      "Arsenal",
      "2026-10-10T11:30:00.000Z",
      "2026-10-06T21:00:00.000Z"
    );
    const plan = planEventReconcile([manUtd, manCity]);
    expect(plan.merges).toHaveLength(0);
  });

  it("reports a teams-match with a start-time conflict as uncertain, never folded", () => {
    const lateKickoff = event(
      "parlay-api:p2",
      "parlay-api",
      "Arsenal",
      "Leeds United FC",
      "2026-10-12T11:30:00.000Z",
      "2026-10-06T21:00:00.000Z"
    );
    const plan = planEventReconcile([ARSENAL_LEEDS_ODDS, lateKickoff]);
    expect(plan.merges).toHaveLength(0);
    expect(plan.uncertain).toHaveLength(1);
    expect(plan.uncertain[0]!.againstCanonicalEventId).toBe("odds-api:o1");
    expect(plan.uncertain[0]!.reasons).toContain("start time outside tolerance");
  });

  it("leaves (Corners) style events untouched", () => {
    const corners = event(
      "parlay-api:corners",
      "parlay-api",
      "Chelsea (Corners)",
      "Bournemouth (Corners)",
      "2026-10-10T14:00:00.000Z",
      "2026-10-06T21:00:00.000Z"
    );
    const match = event(
      "odds-api:chelsea",
      "odds-api",
      "Chelsea",
      "Bournemouth",
      "2026-10-10T14:00:00.000Z",
      "2026-10-06T18:00:00.000Z"
    );
    const plan = planEventReconcile([match, corners]);
    expect(plan.merges).toHaveLength(0);
    expect(plan.standalone).toContain("parlay-api:corners");
  });
});
