import { describe, expect, it } from "vitest";

import {
  classifyFreshness,
  DEFAULT_FRESHNESS_POLICY,
  freshnessSchema,
  freshnessScore,
  ScoreFreshness,
} from "./index.js";

describe("classifyFreshness", () => {
  it("classifies age bands against the spec thresholds", () => {
    expect(classifyFreshness(0)).toBe(ScoreFreshness.FRESH);
    expect(classifyFreshness(4999)).toBe(ScoreFreshness.FRESH);
    expect(classifyFreshness(5000)).toBe(ScoreFreshness.AGING);
    expect(classifyFreshness(14999)).toBe(ScoreFreshness.AGING);
    expect(classifyFreshness(15000)).toBe(ScoreFreshness.STALE);
  });

  it("honours a custom policy", () => {
    const policy = { freshMs: 1_000, agingMs: 2_000 };
    expect(classifyFreshness(1_500, policy)).toBe(ScoreFreshness.AGING);
    expect(classifyFreshness(2_500, policy)).toBe(ScoreFreshness.STALE);
  });
});

describe("freshnessScore", () => {
  const now = new Date("2026-09-17T12:00:00.000Z");

  it("computes age from sourceUpdatedAt and classifies it", () => {
    const fresh = freshnessScore("2026-09-17T11:59:59.000Z", "2026-09-17T11:59:59.500Z", now);
    expect(fresh.ageMs).toBe(1_000);
    expect(fresh.score).toBe(ScoreFreshness.FRESH);

    const stale = freshnessScore("2026-09-17T11:59:40.000Z", "2026-09-17T11:59:40.500Z", now);
    expect(stale.score).toBe(ScoreFreshness.STALE);
  });

  it("clamps a future sourceUpdatedAt to zero age", () => {
    const clamped = freshnessScore("2026-09-17T12:00:05.000Z", "2026-09-17T12:00:02.000Z", now);
    expect(clamped.ageMs).toBe(0);
    expect(clamped.score).toBe(ScoreFreshness.FRESH);
  });
});

describe("freshnessSchema", () => {
  it("accepts a consistent freshness record", () => {
    const record = {
      sourceUpdatedAt: "2026-09-17T11:59:55.000Z",
      ingestedAt: "2026-09-17T11:59:55.500Z",
      ageMs: 1_000,
      score: "FRESH",
    };
    expect(freshnessSchema.safeParse(record).success).toBe(true);
  });

  it("rejects a score inconsistent with the age", () => {
    const record = {
      sourceUpdatedAt: "2026-09-17T11:59:55.000Z",
      ingestedAt: "2026-09-17T11:59:55.500Z",
      ageMs: 1_000,
      score: "STALE",
    };
    expect(freshnessSchema.safeParse(record).success).toBe(false);
  });

  it("exposes sane defaults for the spec example policy", () => {
    expect(DEFAULT_FRESHNESS_POLICY.freshMs).toBe(5_000);
    expect(DEFAULT_FRESHNESS_POLICY.agingMs).toBe(15_000);
  });
});
