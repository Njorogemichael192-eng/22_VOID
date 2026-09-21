import { MarketFamily, Participant, Period } from "@22void/domain";
import { describe, expect, it } from "vitest";

import { buildMockEnvelope, MockProvider } from "./mock-provider";
import { providerEnvelopeSchema } from "./envelope";

const NOW = "2026-09-21T12:00:00.000Z";

describe("MockProvider envelope", () => {
  it("serves a schema-valid envelope covering all canonical families", () => {
    const envelope = buildMockEnvelope(NOW, "mock-test-1");
    expect(providerEnvelopeSchema.safeParse(envelope).success).toBe(true);

    const families = new Set(envelope.events.flatMap((e) => e.markets.map((m) => m.family)));
    for (const family of [
      MarketFamily.MATCH_RESULT,
      MarketFamily.MATCH_TOTAL,
      MarketFamily.ASIAN_TOTAL,
      MarketFamily.ASIAN_HANDICAP,
      MarketFamily.TEAM_TOTAL,
      MarketFamily.TEAM_ASIAN_TOTAL,
      MarketFamily.CORNERS,
      MarketFamily.CARDS,
      MarketFamily.DOUBLE_CHANCE,
      MarketFamily.BTTS,
      MarketFamily.EXACT_SCORE,
    ]) {
      expect(families.has(family), `missing family ${family}`).toBe(true);
    }

    const periods = new Set(envelope.events.flatMap((e) => e.markets.map((m) => m.period)));
    expect(periods.has(Period.FIRST_HALF)).toBe(true);
  });

  it("prices are sharp (finite, > 1.0) with canonical line formatting", () => {
    const envelope = buildMockEnvelope(NOW, "mock-test-2");
    const lineRegex = /^-?\d+(\.\d+)?$/;
    for (const event of envelope.events) {
      for (const market of event.markets) {
        if (market.line !== undefined) {
          expect(lineRegex.test(market.line)).toBe(true);
        }
        for (const price of market.prices) {
          for (const selection of price.selections) {
            expect(Number.isFinite(selection.odds)).toBe(true);
            expect(selection.odds).toBeGreaterThan(1.0);
            expect(selection.providerOutcome.length).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it("tag specific markets with participants and lines", () => {
    const envelope = buildMockEnvelope(NOW, "mock-test-3");
    const asianTotal = envelope.events[0]?.markets.find(
      (m) => m.family === MarketFamily.ASIAN_TOTAL
    );
    expect(asianTotal?.line).toBe("2.25");
    const asianHandicap = envelope.events[0]?.markets.find(
      (m) => m.family === MarketFamily.ASIAN_HANDICAP
    );
    expect(asianHandicap?.participant).toBe(Participant.HOME);
    const teamTotal = envelope.events[0]?.markets.find((m) => m.family === MarketFamily.TEAM_TOTAL);
    expect(teamTotal?.participant).toBe(Participant.HOME);
  });

  it("is deterministic for a fixed now", () => {
    const first = buildMockEnvelope(NOW, "same-request");
    const second = buildMockEnvelope(NOW, "same-request");
    expect(first).toEqual(second);
  });

  it("events carry scheduled status and future start times", () => {
    const envelope = buildMockEnvelope(NOW, "mock-test-4");
    expect(envelope.events.map((e) => e.status)).toEqual(["SCHEDULED", "SCHEDULED"]);
    for (const event of envelope.events) {
      expect(Date.parse(event.startTime)).toBeGreaterThan(Date.parse(NOW));
    }
  });
});

describe("MockProvider.poll / health", () => {
  it("poll returns an envelope plus a raw payload wrapper", async () => {
    const provider = new MockProvider(() => NOW);
    const result = await provider.poll({ sportKey: "soccer_epl" });
    expect(result.envelope.provider).toBe("mock");
    expect(result.envelope.requestId).toBeDefined();
    expect(result.rawPayload.provider).toBe("mock");
    expect(result.rawPayload.endpoint).toBe("/mock");
    expect(result.rawPayload.receivedAt).toBe(NOW);
  });

  it("health reports reachable", async () => {
    const provider = new MockProvider(() => NOW);
    const health = await provider.health();
    expect(health.reachable).toBe(true);
    expect(health.latencyMs).toBe(0);
    expect(health.checkedAt).toBe(NOW);
  });
});
