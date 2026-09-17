import { describe, expect, it } from "vitest";
import type { NormalizationOutcome } from "./index.js";

describe("@22void/normalization skeleton", () => {
  it("exposes the normalization envelope", () => {
    const result: NormalizationOutcome<number> = { normalized: false, confidence: 0 };
    expect(result.normalized).toBe(false);
  });
});