import type { PersistCanonicalRunInput, PersistOpportunityInput } from "@22void/db";
import { describe, expect, it } from "vitest";

import { runDetection, type DetectionReport } from "./detect.js";
import { reconcileOpportunityEpisodes } from "./history.js";
import { createMemoryWorkerStore } from "./store.js";

const NOW = new Date().toISOString();

function reportOf(opportunities: PersistOpportunityInput[]): DetectionReport {
  return { priced: 0, scans: 0, arbs: 0, opportunities };
}

/** One event with a real two-way arb (OVER 2.2 / UNDER 2.1 on total 2.5). */
function arbRun(): PersistCanonicalRunInput {
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
      },
      {
        provider: "book-x",
        sourceMarketId: "src-arb-1:total",
        bookmaker: "book-b",
        outcome: "UNDER",
        odds: 2.1,
        observedAt: NOW,
      },
    ],
  };
}

function opportunityAt(
  eventCanonicalId: string,
  structureType: string,
  selectionIds: string[],
  detectedAt: string,
): PersistOpportunityInput {
  return {
    eventCanonicalId,
    status: "VERIFIED_ARB",
    marketStructure: structureType,
    opportunityKey: keyOf(eventCanonicalId, structureType, selectionIds),
    detectedAt,
    engineVersion: "1",
    legs: selectionIds.map((selectionId) => ({ selectionId, oddsSnapshot: 2.1 })),
    audit: [],
  };
}

function keyOf(eventCanonicalId: string, structureType: string, selectionIds: string[]): string {
  return `episode:${eventCanonicalId}:${structureType}:${[...new Set(selectionIds)].sort().join("+")}`;
}

async function seededStore(): Promise<{
  store: ReturnType<typeof createMemoryWorkerStore>;
  ids: string[];
}> {
  const store = createMemoryWorkerStore(["book-x"]);
  await store.markSourceStatus("book-x", "HEALTHY");
  await store.persistRun(arbRun());
  const ids = (await store.loadPricedSelections()).map((row) => row.id);
  return { store, ids };
}

describe("reconcileOpportunityEpisodes (Phase 15)", () => {
  it("marks episodes absent from a healthy pass as disappeared and restores them", async () => {
    const { store, ids } = await seededStore();
    const [legA, legB] = ids;
    const oppA = opportunityAt("evt-arb-1", "SAME_MARKET_COMPLEMENT", [legA!], "2026-09-23T10:00:00.000Z");
    const oppB = opportunityAt("evt-arb-1", "SAME_MARKET_COMPLEMENT", [legB!], "2026-09-23T10:00:30.000Z");
    await store.persistOpportunity(oppA);
    await store.persistOpportunity(oppB);

    const date10_05 = Date.parse("2026-09-23T10:05:00.000Z");
    const summary = await reconcileOpportunityEpisodes(store, reportOf([oppA]), { now: date10_05 });
    expect(summary).toEqual({ active: 1, disappeared: 1, restored: 0 });

    const afterSweep = store.debugEpisodes();
    expect(afterSweep.find((ep) => ep.key === oppA.opportunityKey)?.disappearedAt).toBeUndefined();
    expect(afterSweep.find((ep) => ep.key === oppB.opportunityKey)?.disappearedAt).toBe(date10_05);

    // The second leg set is detected again at 10:10 → restored.
    const restored = await reconcileOpportunityEpisodes(
      store,
      reportOf([oppA, oppB]),
      { now: Date.parse("2026-09-23T10:10:00.000Z") },
    );
    expect(restored).toEqual({ active: 2, disappeared: 0, restored: 1 });
    expect(store.debugEpisodes().find((ep) => ep.key === oppB.opportunityKey)?.disappearedAt).toBeUndefined();
  });

  it("re-seeing the same episode extends lastSeen and the detected count", async () => {
    const { store, ids } = await seededStore();
    await store.persistOpportunity(opportunityAt("evt-arb-1", "SAME_MARKET_COMPLEMENT", [ids[0]!], "2026-09-23T10:00:00.000Z"));
    await store.persistOpportunity(opportunityAt("evt-arb-1", "SAME_MARKET_COMPLEMENT", [ids[0]!], "2026-09-23T10:01:00.000Z"));

    const episode = store.debugEpisodes()[0];
    expect(episode).toMatchObject({
      detectedCount: 2,
      firstSeenAt: Date.parse("2026-09-23T10:00:00.000Z"),
      lastSeenAt: Date.parse("2026-09-23T10:01:00.000Z"),
      disappearedAt: undefined,
    });
  });

  it("counts only distinct active episodes across an entire report", async () => {
    const { store, ids } = await seededStore();
    const opp = opportunityAt("evt-arb-1", "SAME_MARKET_COMPLEMENT", [ids[0]!], NOW);
    await store.persistOpportunity(opp);

    const summary = await reconcileOpportunityEpisodes(
      store,
      reportOf([opp, { ...opp, detectedAt: NOW }]),
      { now: Date.parse("2026-09-23T10:10:00.000Z") },
    );
    expect(summary.active).toBe(1);
    expect(summary.disappeared).toBe(0);
  });

  it("wires runDetection output straight into the sweep (integration shape)", async () => {
    const store = createMemoryWorkerStore(["book-x"]);
    await store.markSourceStatus("book-x", "HEALTHY");
    await store.persistRun(arbRun());
    const detection = await runDetection(store);
    const history = await reconcileOpportunityEpisodes(store, detection, { now: Date.parse(NOW) });

    const episodes = store.debugEpisodes();
    expect(episodes).toHaveLength(1);
    expect(episodes[0]?.key).toBe(detection.opportunities[0]?.opportunityKey);
    expect(episodes[0]?.disappearedAt).toBeUndefined();
    expect(history.active).toBe(1);
  });
});