import { describe, expect, it } from "vitest";

import { buildMockEnvelope } from "./mock-provider";
import { envelopeToCanonicalRecords, summarizeCanonicalRecords } from "./canonical";
import type { ProviderEnvelope } from "./envelope";

const NOW = "2026-09-21T12:00:00.000Z";

describe("envelopeToCanonicalRecords", () => {
  it("converts the mock envelope into canonical records without rejections", () => {
    const envelope = buildMockEnvelope(NOW, "mock-test-1");
    const records = envelopeToCanonicalRecords(envelope);

    expect(summarizeCanonicalRecords(records)).toEqual({
      events: 2,
      markets: expect.any(Number),
      selections: expect.any(Number),
      rejected: 0,
    });
    expect(records.events).toHaveLength(2);
    expect(records.markets.length).toBeGreaterThan(1);
    expect(records.selections.length).toBeGreaterThan(records.markets.length);
  });

  it("sets observedAt to the ingest time and clamps sourceUpdatedAt to it", () => {
    const envelope = buildMockEnvelope(NOW, "mock-test-2");
    const records = envelopeToCanonicalRecords(envelope);
    const receivedMs = Date.parse(NOW);

    for (const selection of records.selections) {
      expect(selection.observedAt).toBe(NOW);
      expect(Date.parse(selection.sourceUpdatedAt)).toBeLessThanOrEqual(receivedMs);
    }
  });

  it("clamps a future-dated provider timestamp back to receivedAt", () => {
    const envelope = buildMockEnvelope(NOW, "mock-test-3");
    const target = envelope.events[0]?.markets[0]?.prices[0]?.selections[0];
    expect(target).toBeDefined();
    if (target === undefined) return;
    target.sourceUpdatedAt = "2030-01-01T00:00:00.000Z";

    const records = envelopeToCanonicalRecords(envelope);
    expect(records.rejected).toHaveLength(0);
    const matching = records.selections.filter(
      (s) => s.bookmakerId === "book-a" && s.outcome === "HOME"
    );
    expect(matching).toHaveLength(1);
    expect(matching[0]?.sourceUpdatedAt).toBe(NOW);
  });

  it("rejects (never guesses) an event that cannot form a canonical record", () => {
    const envelope = buildMockEnvelope(NOW, "mock-test-4");
    const raw = {
      ...envelope,
      events: [{ ...envelope.events[0]!, startTime: "not-a-date" }],
    } as unknown as ProviderEnvelope;

    const records = envelopeToCanonicalRecords(raw);
    expect(records.events).toHaveLength(0);
    expect(records.rejected).toHaveLength(1);
    expect(records.rejected[0]?.ref).toContain("mock-seriea-001");
  });

  it("rejects a market with an unknown family instead of dropping it silently", () => {
    const envelope = buildMockEnvelope(NOW, "mock-test-5");
    const market = envelope.events[0]?.markets[0];
    expect(market).toBeDefined();
    if (market === undefined) return;
    (market as { family: string }).family = "NOT_A_FAMILY";

    const totalMarkets = envelope.events.reduce((n, e) => n + e.markets.length, 0);
    const records = envelopeToCanonicalRecords(envelope);
    expect(records.events).toHaveLength(2);
    expect(records.markets.length).toBe(totalMarkets - 1);
    expect(records.rejected.some((r) => r.ref.includes("mock-seriea-001"))).toBe(true);
  });
});
