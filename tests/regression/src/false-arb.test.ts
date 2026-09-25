import { reciprocalSum } from "@22void/arbitrage";
import type { Candidate, CandidateScan, PricedSelection } from "@22void/arbitrage";
import {
  classifyStructure,
  generateCandidates,
  isStandardComplement,
  pruneCandidate,
  scanCandidates,
} from "@22void/arbitrage";
import { describe, expect, it } from "vitest";

import {
  regressionCases,
  type RegressionCase,
} from "../../../tests/fixtures/regression/index.js";
import { referenceNow, toArbitrageLeg, toPricedSelection } from "./helpers.js";

const EGRESS_OPTIONS = {
  allowSameBookmaker: false,
};

function findCandidate(scans: CandidateScan[], caseEntry: RegressionCase) {
  const expectedIds = new Set(caseEntry.legs.map((leg) => leg.id));
  return scans.find(
    (scan) =>
      scan.candidate.legs.length === caseEntry.legs.length &&
      scan.candidate.legs.every((leg) => expectedIds.has(leg.id))
  );
}

describe("Phase 17 false-arb regression: structural classification", () => {
  it.each(regressionCases)("$id classifies as $expected.structure", (entry) => {
    const legs = entry.legs.map(toArbitrageLeg);
    expect(classifyStructure(legs)).toBe(entry.expected.structure);
  });

  it("reciprocal traps are marked: sum(1/odds) < 1 yet the case is no arb", () => {
    for (const entry of regressionCases) {
      if (entry.reciprocalTrap !== true) continue;
      expect(reciprocalSum(entry.legs.map((leg) => leg.odds)), entry.id).toBeLessThan(1);
    }
  });

  it("the whole-line complement of CASE_01 is a standard complement", () => {
    const entry = regressionCases.find((candidate) => candidate.id === "CASE_01_STANDARD_COMPLEMENT")!;
    expect(isStandardComplement(entry.legs.map(toArbitrageLeg))).toBe(true);
  });

  it("the generator never merges events within a candidate", () => {
    const entry = regressionCases.find((candidate) => candidate.id === "CASE_12_MISMATCHED_EVENTS")!;
    const generated = generateCandidates(entry.legs.map(toPricedSelection));
    expect(generated).toHaveLength(0);
  });

  it("a hand-forged cross-event candidate is pruned with EVENT_MISMATCH", () => {
    const entry = regressionCases.find((candidate) => candidate.id === "CASE_12_MISMATCHED_EVENTS")!;
    const legs = entry.legs.map(toPricedSelection);
    const forged: Candidate = {
      id: "forged|mismatch",
      eventId: "reg-evt-a",
      period: "FULL_MATCH",
      structureType: "GENERIC",
      legs: legs as PricedSelection[],
    };
    const verdicts = pruneCandidate(forged, {});
    expect(verdicts.some((verdict) => verdict.reason === "EVENT_MISMATCH")).toBe(true);
  });

  it("staleness is mechanical: an old price produces a STALE_ODDS verdict when the option is set", () => {
    const entry = regressionCases.find((candidate) => candidate.id === "CASE_11_STALE_ODDS")!;
    const legs = entry.legs.map(toPricedSelection);
    const candidate: Candidate = {
      id: "stale",
      eventId: "reg-evt-a",
      period: "FULL_MATCH",
      structureType: "SAME_MARKET_COMPLEMENT",
      legs: legs as PricedSelection[],
    };
    const verdicts = pruneCandidate(candidate, {
      now: referenceNow(entry.legs),
      maxAgeMs: 5 * 60_000,
    });
    expect(verdicts.some((verdict) => verdict.reason === "STALE_ODDS")).toBe(true);
  });
});

describe("Phase 17 false-arb regression: scan lifecycle", () => {
  it.each(regressionCases)("$id ends the scan in $expected.scan", (entry) => {
    const priced = entry.legs.map(toPricedSelection);
    const scans = scanCandidates(priced, {
      ...EGRESS_OPTIONS,
      now: referenceNow(entry.legs),
    });

    // The generator refuses to merge distinct canonical events, so CASE_12
    // never reaches the scan stage; its EVENT_MISMATCH verdict is exercised on
    // a hand-forged candidate in the structural suite above.
    if (entry.id === "CASE_12_MISMATCHED_EVENTS") {
      expect(scans).toHaveLength(0);
      return;
    }

    const expected = entry.expected.scan;
    const matched = scans.filter((scan) => scan.status === expected);
    expect(matched.length, `${entry.id} should yield ≥1 ${expected} scan`).toBeGreaterThan(0);

    const full = findCandidate(scans, entry);
    if (entry.expected.reasons !== undefined) {
      const reasons =
        full?.status === "PRUNED"
          ? full.pruning.verdicts.map((verdict) => verdict.reason)
          : full?.coverage !== null && full?.coverage !== undefined
            ? full.coverage.rejections.map((verdict) => verdict.reason)
            : [];
      for (const reason of entry.expected.reasons) {
        expect(reasons, `${entry.id} must surface ${reason}`).toContain(reason);
      }
    }
  });

  it("every ARB golden case delivers a positive guaranteed profit", () => {
    for (const entry of regressionCases) {
      if (entry.expected.scan !== "ARB") continue;
      const scans = scanCandidates(entry.legs.map(toPricedSelection), {
        ...EGRESS_OPTIONS,
        now: referenceNow(entry.legs),
      });
      const arb = scans.find(
        (scan) => scan.status === "ARB" && scan.coverage !== null && scan.plan !== null
      );
      expect(arb, entry.id).toBeDefined();
      if (arb?.plan === null || arb?.plan === undefined || arb === undefined) {
        continue;
      }
      expect(arb.plan.isArb, entry.id).toBe(true);
      expect(arb.plan.guaranteedProfit, entry.id).toBeGreaterThan(0);
      expect(arb.coverage?.status, entry.id).toBe("COVERED");
    }
  });

  it("every REJECTED case is a covered-uncovered overlap model, never a reciprocal shortcut", () => {
    for (const entry of regressionCases) {
      if (entry.expected.scan !== "REJECTED") continue;
      const scans = scanCandidates(entry.legs.map(toPricedSelection), {
        ...EGRESS_OPTIONS,
        now: referenceNow(entry.legs),
      });
      const rejected = findCandidate(scans, entry);
      expect(rejected?.status, entry.id).toBe("REJECTED");
      expect(rejected?.coverage?.status, entry.id).not.toBe("COVERED");
      expect(rejected?.coverage?.rejections.length ?? 0, entry.id).toBeGreaterThan(0);
    }
  });

  it("NO_ARB surfaces an overround result partition that legitimately covers everything", () => {
    const entry = regressionCases.find((candidate) => candidate.id === "CASE_13_NO_ARB_OVERROUND")!;
    const scans = scanCandidates(entry.legs.map(toPricedSelection), {
      ...EGRESS_OPTIONS,
      now: referenceNow(entry.legs),
    });
    const noArb = findCandidate(scans, entry);
    expect(noArb?.status).toBe("NO_ARB");
    expect(noArb?.coverage?.status).toBe("COVERED");
    expect(noArb?.plan?.isArb).toBe(false);
  });
});