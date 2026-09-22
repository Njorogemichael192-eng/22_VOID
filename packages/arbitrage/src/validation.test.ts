import {
  MarketFamily,
  MarketType,
  OpportunityStatus,
  Period,
  RejectionReason,
} from "@22void/domain";
import type { SettleableSelection } from "@22void/settlement";
import { describe, expect, it } from "vitest";

import { scanCandidates } from "./candidates.js";
import type { CandidateScan, PricedSelection, SourceStatus } from "./candidates.js";
import {
  compareRecheckedPrices,
  formatValidationReport,
  relativeDelta,
  validateCandidate,
} from "./validation.js";
import type { ValidationOptions } from "./validation.js";

const NOW = Date.parse("2026-09-21T12:00:00.000Z");

function iso(msBefore: number): string {
  return new Date(NOW - msBefore).toISOString();
}

function total(outcome: "OVER" | "UNDER", line: string): SettleableSelection {
  return {
    family: MarketFamily.MATCH_TOTAL,
    marketType: MarketType.STANDARD,
    outcome,
    line,
    period: Period.FULL_MATCH,
  };
}

interface LegOptions {
  id: string;
  outcome: "OVER" | "UNDER";
  line?: string;
  odds: number;
  bookmaker: string;
  sourceUpdatedAt?: string;
  observedAt?: number;
  provider?: string;
  sourceStatus?: SourceStatus;
  eventConfidence?: number;
  settlementConfidence?: number;
  suspended?: boolean;
}

function priced(options: LegOptions): PricedSelection {
  return {
    id: options.id,
    eventId: "evt-1",
    selection: total(options.outcome, options.line ?? "2.5"),
    odds: options.odds,
    bookmaker: options.bookmaker,
    ...(options.sourceUpdatedAt !== undefined ? { sourceUpdatedAt: options.sourceUpdatedAt } : {}),
    ...(options.observedAt !== undefined ? { observedAt: options.observedAt } : {}),
    ...(options.provider !== undefined ? { provider: options.provider } : {}),
    ...(options.sourceStatus !== undefined ? { sourceStatus: options.sourceStatus } : {}),
    ...(options.eventConfidence !== undefined ? { eventConfidence: options.eventConfidence } : {}),
    ...(options.settlementConfidence !== undefined
      ? { settlementConfidence: options.settlementConfidence }
      : {}),
    ...(options.suspended !== undefined ? { suspended: options.suspended } : {}),
  };
}

/** A provenanced leg: fresh, attested, available. */
function provenanced(
  id: string,
  outcome: "OVER" | "UNDER",
  odds: number,
  bookmaker: string
): PricedSelection {
  return priced({
    id,
    outcome,
    odds,
    bookmaker,
    sourceUpdatedAt: iso(1_000),
    observedAt: NOW - 500,
    provider: "odds-api",
    sourceStatus: "OK",
    eventConfidence: 0.95,
    settlementConfidence: 1,
  });
}

function arbScan(legs: readonly PricedSelection[]): CandidateScan {
  const scans = scanCandidates([...legs]);
  const arb = scans.find((scan) => scan.status === "ARB");
  if (arb === undefined) {
    throw new Error(`expected an ARB scan, got ${scans.map((scan) => scan.status).join(", ")}`);
  }
  return arb;
}

function recheck(
  ...prices: { legId: string; recheckedOdds: number }[]
): { legId: string; recheckedOdds: number }[] {
  return prices;
}

describe("relativeDelta / compareRecheckedPrices", () => {
  it("computes the relative delta", () => {
    expect(relativeDelta(2.0, 2.0)).toBe(0);
    expect(relativeDelta(2.0, 2.1)).toBeCloseTo(0.05, 6);
  });

  it("reports OK when prices are unchanged", () => {
    const legs = [provenanced("o", "OVER", 2.2, "a"), provenanced("u", "UNDER", 2.1, "b")];
    const result = compareRecheckedPrices(
      legs,
      recheck({ legId: "o", recheckedOdds: 2.2 }, { legId: "u", recheckedOdds: 2.1 }),
      0.001,
      NOW
    );
    expect(result.status).toBe("OK");
    expect(result.covering).toBe(true);
    expect(result.changed).toHaveLength(0);
  });

  it("flags moved prices with the delta", () => {
    const legs = [provenanced("o", "OVER", 2.2, "a"), provenanced("u", "UNDER", 2.1, "b")];
    const result = compareRecheckedPrices(
      legs,
      recheck({ legId: "o", recheckedOdds: 2.05 }, { legId: "u", recheckedOdds: 2.1 }),
      0.001,
      NOW
    );
    expect(result.status).toBe("CHANGED");
    expect(result.changed).toHaveLength(1);
    expect(result.changed[0]).toMatchObject({ legId: "o", priorOdds: 2.2, currentOdds: 2.05 });
  });

  it("marks a recheck that missed a leg as non-covering", () => {
    const legs = [provenanced("o", "OVER", 2.2, "a"), provenanced("u", "UNDER", 2.1, "b")];
    const result = compareRecheckedPrices(
      legs,
      recheck({ legId: "o", recheckedOdds: 2.2 }),
      0.001,
      NOW
    );
    expect(result.covering).toBe(false);
  });
});

describe("validateCandidate — verification path", () => {
  const options: ValidationOptions = { now: NOW };

  it("requires provenance (theoretical, never verified)", () => {
    const bare = [
      { id: "o", eventId: "evt-1", selection: total("OVER", "2.5"), odds: 2.2, bookmaker: "a" },
      { id: "u", eventId: "evt-1", selection: total("UNDER", "2.5"), odds: 2.1, bookmaker: "b" },
    ];
    const report = validateCandidate(arbScan(bare), bare, options);
    expect(report.status).toBe(OpportunityStatus.THEORETICAL_ARB);
    expect(report.verified).toBe(false);
    expect(report.rejections.map((failure) => failure.reason)).toContain("INSUFFICIENT_PROVENANCE");
  });

  it("promotes a fresh, attested, rechecked arb to VERIFIED_ARB", () => {
    const legs = [provenanced("o", "OVER", 2.2, "a"), provenanced("u", "UNDER", 2.1, "b")];
    const report = validateCandidate(
      arbScan(legs),
      legs,
      options,
      recheck({ legId: "o", recheckedOdds: 2.2 }, { legId: "u", recheckedOdds: 2.1 })
    );
    expect(report.status).toBe(OpportunityStatus.VERIFIED_ARB);
    expect(report.verified).toBe(true);
    expect(report.theoretical).toBe(true);
    expect(report.hasValidationInput).toBe(true);
    expect(report.recheck.status).toBe("OK");
    expect(report.rejections).toHaveLength(0);
    for (const leg of report.legs) {
      expect(leg.priceAgePass).toBe(true);
      expect(leg.sourcePass).toBe(true);
      expect(leg.eventConfidencePass).toBe(true);
      expect(leg.settlementConfidencePass).toBe(true);
    }
  });

  it("stops at FRESH_ARB when no final recheck has run", () => {
    const legs = [provenanced("o", "OVER", 2.2, "a"), provenanced("u", "UNDER", 2.1, "b")];
    const report = validateCandidate(arbScan(legs), legs, options);
    expect(report.status).toBe(OpportunityStatus.FRESH_ARB);
    expect(report.verified).toBe(false);
    expect(report.recheck.status).toBe("NOT_RUN");
  });

  it("still verifies an AGING price that is within the staleness horizon", () => {
    const legs = [
      priced({
        id: "o",
        outcome: "OVER",
        odds: 2.2,
        bookmaker: "a",
        sourceUpdatedAt: iso(10_000),
        observedAt: NOW - 9_000,
        provider: "odds-api",
        sourceStatus: "OK",
        eventConfidence: 0.95,
        settlementConfidence: 1,
      }),
      provenanced("u", "UNDER", 2.1, "b"),
    ];
    const report = validateCandidate(
      arbScan(legs),
      legs,
      options,
      recheck({ legId: "o", recheckedOdds: 2.2 }, { legId: "u", recheckedOdds: 2.1 })
    );
    expect(report.status).toBe(OpportunityStatus.VERIFIED_ARB);
    expect(report.freshness.bands).toContain("AGING");
  });

  it("never verifies a non-ARB scan", () => {
    const pruned = scanCandidates([
      { ...provenanced("o", "OVER", 2.2, "a"), suspended: true },
      provenanced("u", "UNDER", 2.1, "b"),
    ]);
    const scan = pruned.find((entry) => entry.status === "PRUNED")!;
    const report = validateCandidate(scan, scan.candidate.legs, options);
    expect(report.verified).toBe(false);
  });
});

describe("validateCandidate — rejection paths", () => {
  const options: ValidationOptions = { now: NOW };

  it("invalidates when the final recheck finds a moved price", () => {
    const legs = [provenanced("o", "OVER", 2.2, "a"), provenanced("u", "UNDER", 2.1, "b")];
    const report = validateCandidate(
      arbScan(legs),
      legs,
      options,
      recheck({ legId: "o", recheckedOdds: 2.05 }, { legId: "u", recheckedOdds: 2.1 })
    );
    expect(report.status).toBe(OpportunityStatus.INVALIDATED);
    expect(report.verified).toBe(false);
    expect(report.rejections.map((failure) => failure.reason)).toContain(
      "PRICE_CHANGED_ON_RECHECK"
    );
    expect(report.rejections[0]?.detail).toContain("2.2");
  });

  it("invalidates when the recheck cannot cover every leg", () => {
    const legs = [provenanced("o", "OVER", 2.2, "a"), provenanced("u", "UNDER", 2.1, "b")];
    const report = validateCandidate(
      arbScan(legs),
      legs,
      options,
      recheck({ legId: "o", recheckedOdds: 2.2 })
    );
    expect(report.status).toBe(OpportunityStatus.INVALIDATED);
    expect(report.rejections.map((failure) => failure.reason)).toContain("PROVIDER_UNAVAILABLE");
  });

  it("marks stale prices STALE and never verified", () => {
    const staleOver = priced({
      id: "o",
      outcome: "OVER",
      odds: 2.2,
      bookmaker: "a",
      sourceUpdatedAt: iso(60_000),
      observedAt: NOW - 59_000,
      provider: "odds-api",
      sourceStatus: "OK",
      eventConfidence: 0.95,
      settlementConfidence: 1,
    });
    const freshUnder = provenanced("u", "UNDER", 2.1, "b");
    const report = validateCandidate(
      arbScan([staleOver, freshUnder]),
      [staleOver, freshUnder],
      options
    );
    expect(report.status).toBe(OpportunityStatus.STALE);
    expect(report.verified).toBe(false);
    expect(report.rejections.map((failure) => failure.reason)).toContain("STALE_ODDS");
  });

  it("rejects a leg whose event confidence sits below the verification floor", () => {
    const uncertain = priced({
      id: "o",
      outcome: "OVER",
      odds: 2.2,
      bookmaker: "a",
      sourceUpdatedAt: iso(1_000),
      observedAt: NOW - 500,
      provider: "odds-api",
      sourceStatus: "OK",
      eventConfidence: 0.85,
      settlementConfidence: 1,
    });
    const legs = [uncertain, provenanced("u", "UNDER", 2.1, "b")];
    // Phase 10 pruning uses a 0.8 floor, so 0.85 scans ARB; Phase 11 asks more.
    const report = validateCandidate(arbScan(legs), legs, { now: NOW, minEventConfidence: 0.9 });
    expect(report.status).toBe(OpportunityStatus.REJECTED);
    expect(report.rejections.map((failure) => failure.reason)).toContain("EVENT_MATCH_UNCERTAIN");
  });

  it("rejects a leg whose settlement confidence is too low", () => {
    const disputed = priced({
      id: "o",
      outcome: "OVER",
      odds: 2.2,
      bookmaker: "a",
      sourceUpdatedAt: iso(1_000),
      observedAt: NOW - 500,
      provider: "odds-api",
      sourceStatus: "OK",
      eventConfidence: 0.95,
      settlementConfidence: 0.4,
    });
    const legs = [disputed, provenanced("u", "UNDER", 2.1, "b")];
    const report = validateCandidate(arbScan(legs), legs, options);
    expect(report.status).toBe(OpportunityStatus.REJECTED);
    expect(report.rejections.map((failure) => failure.reason)).toContain(
      "SETTLEMENT_CONFIDENCE_LOW"
    );
  });

  it("rejects a leg backed by an unavailable source", () => {
    const down = priced({
      id: "o",
      outcome: "OVER",
      odds: 2.2,
      bookmaker: "a",
      sourceUpdatedAt: iso(1_000),
      observedAt: NOW - 500,
      provider: "odds-api",
      sourceStatus: "DOWN",
      eventConfidence: 0.95,
      settlementConfidence: 1,
    });
    const legs = [down, provenanced("u", "UNDER", 2.1, "b")];
    const report = validateCandidate(arbScan(legs), legs, options);
    expect(report.status).toBe(OpportunityStatus.REJECTED);
    expect(report.rejections.map((failure) => failure.reason)).toContain("PROVIDER_UNAVAILABLE");
  });

  it("rejects legs whose source timestamps are not contemporaneous", () => {
    const lagged = priced({
      id: "o",
      outcome: "OVER",
      odds: 2.2,
      bookmaker: "a",
      sourceUpdatedAt: iso(120_000),
      observedAt: NOW - 119_000,
      provider: "odds-api",
      sourceStatus: "OK",
      eventConfidence: 0.95,
      settlementConfidence: 1,
    });
    const legs = [lagged, provenanced("u", "UNDER", 2.1, "b")];
    const report = validateCandidate(arbScan(legs), legs, {
      now: NOW,
      maxAgeMs: 200_000,
      freshnessPolicy: { freshMs: 300_000, agingMs: 400_000 },
    });
    expect(report.status).toBe(OpportunityStatus.REJECTED);
    expect(report.rejections.map((failure) => failure.reason)).toContain(
      "CROSS_SOURCE_TIMESTAMP_SPREAD"
    );
    expect(report.rejections[0]?.detail).toContain("119000");
  });

  it("rejects a NO_ARB scan with the optimizer reason", () => {
    const noArbLegs = [
      priced({
        id: "a",
        outcome: "OVER",
        line: "1.0",
        odds: 1.5,
        bookmaker: "a",
        sourceUpdatedAt: iso(1_000),
        observedAt: NOW - 500,
        provider: "p",
        sourceStatus: "OK",
        eventConfidence: 0.95,
        settlementConfidence: 1,
      }),
      priced({
        id: "b",
        outcome: "UNDER",
        line: "1.5",
        odds: 2.4,
        bookmaker: "b",
        sourceUpdatedAt: iso(1_000),
        observedAt: NOW - 500,
        provider: "p",
        sourceStatus: "OK",
        eventConfidence: 0.95,
        settlementConfidence: 1,
      }),
    ];
    const scans = scanCandidates(noArbLegs);
    const noArb = scans.find((scan) => scan.status === "NO_ARB");
    expect(noArb).toBeDefined();
    const report = validateCandidate(noArb!, noArbLegs, options);
    expect(report.status).toBe(OpportunityStatus.REJECTED);
    expect(report.rejections.map((failure) => failure.reason)).toContain(
      RejectionReason.NEGATIVE_GUARANTEED_PROFIT
    );
  });

  it("rejects a PRUNED scan carrying the prune reason", () => {
    const suspended = [
      priced({
        id: "o",
        outcome: "OVER",
        odds: 2.2,
        bookmaker: "a",
        suspended: true,
        sourceUpdatedAt: iso(1_000),
        observedAt: NOW - 500,
        provider: "p",
        sourceStatus: "OK",
        eventConfidence: 0.95,
        settlementConfidence: 1,
      }),
      provenanced("u", "UNDER", 2.1, "b"),
    ];
    const scans = scanCandidates(suspended);
    const pruned = scans.find((scan) => scan.status === "PRUNED");
    expect(pruned).toBeDefined();
    const report = validateCandidate(pruned!, suspended, options);
    expect(report.status).toBe(OpportunityStatus.REJECTED);
    expect(report.verified).toBe(false);
    expect(report.rejections.length).toBeGreaterThan(0);
  });
});

describe("formatValidationReport", () => {
  it("renders a multi-line, explainable verdict", () => {
    const legs = [provenanced("o", "OVER", 2.2, "a"), provenanced("u", "UNDER", 2.1, "b")];
    const report = validateCandidate(
      arbScan(legs),
      legs,
      { now: NOW },
      recheck({ legId: "o", recheckedOdds: 2.2 }, { legId: "u", recheckedOdds: 2.1 })
    );
    const text = formatValidationReport(report);
    expect(text).toContain("VERIFIED_ARB");
    expect(text).toContain("theoretical=true");
    expect(text).toContain("recheck: OK");
  });
});
