import { describe, expect, it } from "vitest";

import {
  canonicalEventSchema,
  canonicalSelectionSchema,
  decimalOddsSchema,
  freshnessSchema,
  marketStructureSchema,
  settlementStateSchema,
} from "./index.js";
import { fixtures } from "../../../tests/fixtures/domain/index.js";

describe("Phase 2 fixtures validate correctly", () => {
  it("validates every canonical event fixture", () => {
    for (const event of fixtures.events) {
      expect(canonicalEventSchema.safeParse(event).success, JSON.stringify(event)).toBe(true);
    }
  });

  it("validates every market structure fixture", () => {
    for (const market of fixtures.markets) {
      expect(marketStructureSchema.safeParse(market).success, JSON.stringify(market)).toBe(true);
    }
  });

  it("validates every selection fixture", () => {
    for (const selection of fixtures.selections) {
      expect(canonicalSelectionSchema.safeParse(selection).success, JSON.stringify(selection)).toBe(
        true
      );
    }
  });

  it("validates every settlement state fixture", () => {
    for (const state of fixtures.settlementStates) {
      expect(settlementStateSchema.safeParse(state).success, JSON.stringify(state)).toBe(true);
    }
  });

  it("validates every freshness fixture", () => {
    for (const record of fixtures.freshness) {
      expect(freshnessSchema.safeParse(record).success, JSON.stringify(record)).toBe(true);
    }
  });

  it("validates every decimal odds fixture", () => {
    for (const odds of fixtures.validOdds) {
      expect(decimalOddsSchema.safeParse(odds).success, String(odds)).toBe(true);
    }
  });
});
