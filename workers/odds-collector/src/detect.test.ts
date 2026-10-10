import type { PersistCanonicalRunInput } from "@22void/db";
import { describe, expect, it } from "vitest";

import { runDetection } from "./detect.js";
import { createMemoryWorkerStore } from "./store.js";

const NOW = new Date().toISOString();

/** A genuine two-way arb (1/2.2 + 1/2.1 < 1) on one total 2.5 market. */
function builtArbRun(): PersistCanonicalRunInput {
  return {
    provider: "book-x",
    events: [
      {
        canonicalEventId: "evt-arb-1",
        competition: "Premier League",
        homeTeam: "Home FC",
        awayTeam: "Away FC",
        startTime: NOW,
        status: "SCHEDULED",
        sources: [{ provider: "book-x", sourceEventId: "src-arb-1", eventConfidence: 1 }],
      },
    ],
    markets: [
      {
        provider: "book-x",
        sourceMarketId: "src-arb-1:total",
        eventCanonicalId: "evt-arb-1",
        family: "MATCH_TOTAL",
        marketType: "STANDARD",
        period: "FULL_MATCH",
        line: "2.5",
      },
    ],
    selections: [
      {
        provider: "book-x",
        sourceMarketId: "src-arb-1:total",
        bookmaker: "book-a",
        outcome: "OVER",
        odds: 2.2,
        observedAt: NOW,
        sourceUpdatedAt: NOW,
      },
      {
        provider: "book-x",
        sourceMarketId: "src-arb-1:total",
        bookmaker: "book-b",
        outcome: "UNDER",
        odds: 2.1,
        observedAt: NOW,
        sourceUpdatedAt: NOW,
      },
    ],
  };
}

/** One provider's listing of the same total 2.5 market (Phase 19 fallback). */
function fallbackRun(
  provider: string,
  selections: Array<{ bookmaker: string; outcome: "OVER" | "UNDER"; odds: number }>
): PersistCanonicalRunInput {
  return {
    provider,
    events: [
      {
        canonicalEventId: "evt-fb-1",
        competition: "Premier League",
        homeTeam: "Home FC",
        awayTeam: "Away FC",
        startTime: NOW,
        status: "SCHEDULED",
        sources: [{ provider, sourceEventId: `${provider}-src`, eventConfidence: 1 }],
      },
    ],
    markets: [
      {
        provider,
        sourceMarketId: `${provider}-total`,
        eventCanonicalId: "evt-fb-1",
        family: "MATCH_TOTAL",
        marketType: "STANDARD",
        period: "FULL_MATCH",
        line: "2.5",
      },
    ],
    selections: selections.map((entry) => ({
      provider,
      sourceMarketId: `${provider}-total`,
      bookmaker: entry.bookmaker,
      outcome: entry.outcome,
      odds: entry.odds,
      observedAt: NOW,
      sourceUpdatedAt: NOW,
    })),
  };
}

describe("runDetection", () => {
  it("detects a real arb and persists it as a verified opportunity", async () => {
    const store = createMemoryWorkerStore(["book-x"]);
    await store.markSourceStatus("book-x", "HEALTHY");
    const persist = await store.persistRun(builtArbRun());
    expect(persist.invalid).toBe(0);
    expect(persist.selections).toBe(2);

    const report = await runDetection(store);

    expect(report.priced).toBe(2);
    expect(report.scans).toBeGreaterThan(0);
    expect(report.arbs).toBe(1);

    const opportunities = store.debugOpportunities();
    expect(opportunities.length).toBe(report.opportunities.length);
    expect(opportunities[0]?.status).toBe("VERIFIED_ARB");
    expect(opportunities[0]?.eventCanonicalId).toBe("evt-arb-1");
    expect(opportunities[0]?.legs.length).toBe(2);
    expect(opportunities[0]?.guaranteedProfit).toBeGreaterThan(0);
    expect(opportunities[0]?.roi).toBeGreaterThan(0);
    for (const leg of opportunities[0]?.legs ?? []) {
      expect(leg.selectionId).toMatch(/^sel-\d+$/);
      expect(leg.oddsSnapshot).toBeGreaterThan(1);
    }
  });

  it("stamps a deterministic opportunity key on each detected arb", async () => {
    const store = createMemoryWorkerStore(["book-x"]);
    await store.markSourceStatus("book-x", "HEALTHY");
    await store.persistRun(builtArbRun());

    const first = await runDetection(store);
    const firstKey = first.opportunities[0]?.opportunityKey;
    const ids = first.opportunities[0]?.legs.map((leg) => leg.selectionId) ?? [];

    expect(firstKey).toBeDefined();
    expect(firstKey).toMatch(/^episode:evt-arb-1:SAME_MARKET_COMPLEMENT:/);
    for (const id of ids) {
      expect(firstKey).toContain(id);
    }

    // Re-detecting the same legs must yield the same identity (one episode).
    const second = await runDetection(store);
    expect(second.opportunities[0]?.opportunityKey).toBe(firstKey);
  });

  it("falls back to a healthy source when the best price comes from a down source", async () => {
    const store = createMemoryWorkerStore(["down-src", "live-src"]);
    await store.markSourceStatus("live-src", "HEALTHY");
    await store.markSourceStatus("down-src", "DOWN");
    // The unavailable source quotes the best OVER price...
    await store.persistRun(
      fallbackRun("down-src", [{ bookmaker: "book-a", outcome: "OVER", odds: 2.5 }])
    );
    // ...but a healthy source quotes a slightly worse OVER plus the UNDER leg.
    await store.persistRun(
      fallbackRun("live-src", [
        { bookmaker: "book-a", outcome: "OVER", odds: 2.1 },
        { bookmaker: "book-b", outcome: "UNDER", odds: 2.1 },
      ])
    );

    const report = await runDetection(store);
    expect(report.arbs).toBe(1);
    const opportunity = store.debugOpportunities()[0];
    expect(opportunity?.status).toBe("VERIFIED_ARB");
    // Both legs priced from the healthy source (2.1), not the down 2.5.
    expect(opportunity?.legs.every((leg) => leg.oddsSnapshot === 2.1)).toBe(true);
  });

  it("still rejects a candidate whose only supplier is down", async () => {
    const store = createMemoryWorkerStore(["down-src"]);
    await store.markSourceStatus("down-src", "DOWN");
    await store.persistRun(
      fallbackRun("down-src", [
        { bookmaker: "book-a", outcome: "OVER", odds: 2.2 },
        { bookmaker: "book-b", outcome: "UNDER", odds: 2.1 },
      ])
    );

    const report = await runDetection(store);
    expect(report.arbs).toBe(1);
    const opportunity = store.debugOpportunities()[0];
    expect(opportunity?.status).toBe("REJECTED");
    expect(opportunity?.rejectionReason).toBe("PROVIDER_UNAVAILABLE");
  });
});