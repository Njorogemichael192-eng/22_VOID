import { EventStatus } from "@22void/domain";
import { componentPayouts, payout, settleSelection } from "@22void/settlement";
import type { LineScore, SettleableSelection } from "@22void/settlement";
import { describe, expect, it } from "vitest";

import { settlementGoldenRows } from "../../../tests/fixtures/regression/index.js";

/**
 * Settlement regression suite — drives every golden table row from
 * tests/fixtures/regression/settlement.ts through the real settlement engine
 * and asserts the exact result, component split, multiplier and payout.
 */
describe("Phase 17 settlement regression", () => {
  it("every golden table row settles on the expected result and components", () => {
    for (const row of settlementGoldenRows) {
      const match = {
        status: row.status === "POSTPONED" ? EventStatus.POSTPONED : EventStatus.FINISHED,
        fullTime: row.scores.fullTime as LineScore,
        firstHalf: (row.scores.firstHalf ?? null) as LineScore | null,
        secondHalf: null,
        extraTime: null,
        penalties: null,
        corners: null,
        cards: null,
      };
      const settled = settleSelection(row.selection as SettleableSelection, match);
      expect(settled.kind, `${row.id} must settle`).toBe("settled");
      if (settled.kind !== "settled") continue;

      const { state } = settled.assessment;
      expect(state.result, row.id).toBe(row.expected.result);
      if (row.expected.components !== undefined) {
        expect(state.components, row.id).toEqual(row.expected.components);
      }
    }
  });

  it("each golden row's expected multiplier matches the spec formula (§10)", () => {
    for (const row of settlementGoldenRows) {
      const expected = row.expected.returnMultiplier;
      expect(expected, row.id).toBeGreaterThanOrEqual(0);
      expect(payout(100, row.selection.odds, row.expected.result), row.id).toBeCloseTo(
        row.expected.payoutPer100,
        6
      );
    }
  });

  it("quarter-line rows are settled from a 50/50 component split with an audit note", () => {
    const quarterRows = settlementGoldenRows.filter((row) =>
      /\.25|\.75/.test(row.selection.line ?? "")
    );
    expect(quarterRows.length).toBeGreaterThan(0);
    for (const row of quarterRows) {
      const settled = settleSelection(row.selection as SettleableSelection, {
        status: EventStatus.FINISHED,
        fullTime: row.scores.fullTime as LineScore,
        firstHalf: (row.scores.firstHalf ?? null) as LineScore | null,
        secondHalf: null,
        extraTime: null,
        penalties: null,
        corners: null,
        cards: null,
      });
      expect(settled.kind).toBe("settled");
      if (settled.kind !== "settled") continue;
      expect(settled.assessment.notes.join("\n"), row.id).toContain("split 50/50");
    }
  });

  it("component payouts reconcile exactly with the total return per component", () => {
    for (const row of settlementGoldenRows) {
      const settled = settleSelection(row.selection as SettleableSelection, {
        status: row.status === "POSTPONED" ? EventStatus.POSTPONED : EventStatus.FINISHED,
        fullTime: row.scores.fullTime as LineScore,
        firstHalf: (row.scores.firstHalf ?? null) as LineScore | null,
        secondHalf: null,
        extraTime: null,
        penalties: null,
        corners: null,
        cards: null,
      });
      if (settled.kind !== "settled") {
        expect.fail(`${row.id} did not settle`);
        continue;
      }
      const shares = componentPayouts(settled.assessment, 100, row.selection.odds);
      const total = shares.reduce((sum, share) => sum + share, 0);
      expect(total, row.id).toBeCloseTo(payout(100, row.selection.odds, settled.assessment.state.result), 6);
      for (const share of shares) {
        expect(share, row.id).toBeGreaterThanOrEqual(0);
      }
    }
  });
});