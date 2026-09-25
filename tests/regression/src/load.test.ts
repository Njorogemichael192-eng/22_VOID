import { scanCandidates, generateCandidates } from "@22void/arbitrage";
import { describe, expect, it } from "vitest";

import {
  buildRegressionBatch,
  mulberry32,
  reciprocalSum,
  type RegressionLeg,
} from "../../../tests/fixtures/regression/index.js";
import { toPricedSelection } from "./helpers.js";

const asLeg = (leg: unknown): RegressionLeg => leg as RegressionLeg;
const pricedFrom = (batch: ReturnType<typeof buildRegressionBatch>) =>
  batch.map((leg) => toPricedSelection(asLeg(leg)));

const EVENTS = 20;
const LEGS_PER_EVENT = 15;
// All 15 legs share the FULL_MATCH period, so the generator stages every pair
// and triple within one group. Cross-family incompatibility (BTTS/CARDS-style
// vs MATCH_RESULT) prunes the illegitimate mixes; the exact per-event count is
// measured from the generator itself to keep this a scale test, not a copy of
// the compatibility matrix.
const perEventCandidates = (priced: ReturnType<typeof pricedFrom>) =>
  generateCandidates(priced.filter((leg) => leg.eventId === "load-evt-000")).length;

describe("Phase 17 candidate-generation load regression", () => {
  it("generates a deterministic synthetic batch of the documented scale", () => {
    const batch = buildRegressionBatch({ events: EVENTS, arbEveryN: 5, seed: 7 });
    expect(batch).toHaveLength(EVENTS * LEGS_PER_EVENT);

    const rebuilt = buildRegressionBatch({ events: EVENTS, arbEveryN: 5, seed: 7 });
    expect(rebuilt).toEqual(batch);

    const reseeded = buildRegressionBatch({ events: EVENTS, arbEveryN: 5, seed: 99 });
    expect(reseeded).not.toEqual(batch);

    for (const leg of batch) {
      expect(leg.odds).toBeGreaterThanOrEqual(1.01);
      expect(leg.eventConfidence).toBeGreaterThan(0);
      expect(leg.sourceStatus).toBe("OK");
    }
  });

  it("forces a real underround complement on every arbEveryN-th event", () => {
    const batch = buildRegressionBatch({ events: EVENTS, arbEveryN: 5, seed: 7 });
    for (let event = 0; event < EVENTS; event += 5) {
      const id = `load-evt-${String(event).padStart(3, "0")}`;
      const legs = batch.filter((leg) => leg.eventId === id);
      const pair = legs.filter(
        (leg) => leg.family === "MATCH_TOTAL" && leg.line === "2.5"
      );
      expect(pair).toHaveLength(2);
      expect(reciprocalSum(pair.map((leg) => leg.odds))).toBeLessThan(1);
      expect(pair[0]!.bookmaker).not.toBe(pair[1]!.bookmaker);
    }
  });

  it("mulberry32 is deterministic and reproducible", () => {
    const a = Array.from({ length: 5 }, mulberry32(42));
    const b = Array.from({ length: 5 }, mulberry32(42));
    expect(a).toEqual(b);
    const c = Array.from({ length: 5 }, mulberry32(7));
    expect(c).not.toEqual(a);
  });

  it("scans a 20-event batch inside the candidate cap without merging events", () => {
    const batch = buildRegressionBatch({ events: EVENTS, arbEveryN: 5, seed: 7 });
    const priced = pricedFrom(batch);

    const candidates = generateCandidates(priced);
    const perEvent = perEventCandidates(priced);
    expect(perEvent).toBeGreaterThanOrEqual(100);
    expect(perEvent).toBeLessThan(560);
    expect(candidates).toHaveLength(EVENTS * perEvent);
    expect(candidates.length).toBeLessThan(20_000);
    for (const candidate of candidates) {
      expect(candidate.eventId.startsWith("load-evt-")).toBe(true);
      expect(candidate.legs.every((leg) => leg.eventId === candidate.eventId)).toBe(true);
    }
  });

  it(
    "produces guaranteed-profit arbs at the expected density within the timeout budget",
    () => {
      const batch = buildRegressionBatch({ events: EVENTS, arbEveryN: 5, seed: 7 });
      const priced = pricedFrom(batch);
      const base = Date.parse(batch[0]!.sourceUpdatedAt);
      const scans = scanCandidates(priced, {
        allowSameBookmaker: false,
        now: base + 120_000,
      });

      expect(scans).toHaveLength(EVENTS * perEventCandidates(priced));
      const arbs = scans.filter((scan) => scan.status === "ARB");
      // The always-underround BTTS pair is independently arbitrageable, and the
      // forced underround events (0,5,10,15) add the five two-way pairs plus the
      // 1X2 partition, so arbs are guaranteed on every single event.
      expect(arbs.length).toBeGreaterThanOrEqual(EVENTS);
      for (const arb of arbs) {
        expect(arb.plan?.isArb).toBe(true);
        expect(arb.plan?.guaranteedProfit).toBeGreaterThan(0);
        const books = new Set(arb.candidate.legs.map((leg) => leg.bookmaker));
        expect(books.size).toBe(arb.candidate.legs.length);
      }
    },
    30_000
  );
});