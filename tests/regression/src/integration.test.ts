import {
  envelopeToCanonicalRecords,
  providerEnvelopeSchema,
  MockProvider,
} from "@22void/provider-contracts";
import { runDetection, createMemoryWorkerStore, runScanCycle, type WorkerStore } from "@22void/odds-collector";
import { describe, expect, it } from "vitest";

const RECEIVED_AT = "2026-09-20T12:05:00.000Z";

interface PriceSource {
  book: string;
  outcome: string;
  odds: number;
  sourceUpdatedAt?: string;
}

function buildEnvelope(provider: string, prices: PriceSource[]) {
  return providerEnvelopeSchema.parse({
    provider,
    requestId: "req-int-001",
    receivedAt: RECEIVED_AT,
    skippedOutcomes: [],
    events: [
      {
        providerEventId: "int-evt-1",
        competition: "Premier League",
        homeTeam: "Home FC",
        awayTeam: "Away FC",
        startTime: RECEIVED_AT,
        status: "SCHEDULED",
        markets: [
          {
            sourceMarketId: "total",
            family: "MATCH_TOTAL",
            marketType: "STANDARD",
            period: "FULL_MATCH",
            line: "2.5",
            prices: prices.map((price) => ({
              bookmakerKey: price.book,
              sourceUpdatedAt: price.sourceUpdatedAt ?? RECEIVED_AT,
              selections: [
                {
                  outcome: price.outcome,
                  providerOutcome: price.outcome,
                  odds: price.odds,
                  sourceUpdatedAt: price.sourceUpdatedAt ?? RECEIVED_AT,
                },
              ],
            })),
          },
        ],
      },
    ],
  });
}

async function persistFromEnvelope(_store: WorkerStore, provider: string, prices: PriceSource[]) {
  const envelope = buildEnvelope(provider, prices);
  const records = envelopeToCanonicalRecords(envelope);
  expect(records.rejected).toHaveLength(0);
  return records;
}

/** Fold the canonical records into the store exactly like a scan cycle does. */
async function ingest(store: WorkerStore, provider: string, records: Awaited<ReturnType<typeof persistFromEnvelope>>) {
  const { normalizeRun } = await import("@22void/odds-collector");
  const seeds = await store.loadEventSeeds();
  const output = normalizeRun(provider, records, seeds);
  return store.persistRun(output.persist);
}

describe("Phase 17 integration regression: normalize → persist → detect pipeline", () => {
  it("a genuine complementary arb is persisted as VERIFIED_ARB with a stable episode key", async () => {
    const store = createMemoryWorkerStore(["odds-api"]);
    await store.markSourceStatus("odds-api", "HEALTHY");

    const records = await persistFromEnvelope(store, "odds-api", [
      { book: "book-a", outcome: "OVER", odds: 2.2 },
      { book: "book-b", outcome: "UNDER", odds: 2.1 },
    ]);
    const persist = await ingest(store, "odds-api", records);
    expect(persist.invalid).toBe(0);
    expect(persist.selections).toBe(2);

    const report = await runDetection(store, { now: Date.parse(RECEIVED_AT) });
    expect(report.priced).toBe(2);
    expect(report.arbs).toBe(1);

    const opportunities = store.debugOpportunities();
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0]?.status).toBe("VERIFIED_ARB");
    expect(opportunities[0]?.eventCanonicalId).toBe("odds-api:int-evt-1");
    expect(opportunities[0]?.guaranteedProfit).toBeGreaterThan(0);
    expect(opportunities[0]?.legs).toHaveLength(2);

    // The same identity is re-established on a second pass → one episode.
    const again = await runDetection(store, { now: Date.parse(RECEIVED_AT) });
    expect(again.opportunities[0]?.opportunityKey).toBe(opportunities[0]?.opportunityKey);
  });

  it("an otherwise-arbitrageable candidate with an old price is validated STALE, never verified", async () => {
    const store = createMemoryWorkerStore(["odds-api"]);
    await store.markSourceStatus("odds-api", "HEALTHY");

    const records = await persistFromEnvelope(store, "odds-api", [
      { book: "book-a", outcome: "OVER", odds: 2.2 },
      { book: "book-b", outcome: "UNDER", odds: 2.1, sourceUpdatedAt: "2026-09-20T10:00:00.000Z" },
    ]);
    await ingest(store, "odds-api", records);

    const report = await runDetection(store, { now: Date.parse(RECEIVED_AT) });
    expect(report.arbs).toBe(1);
    const opportunity = store.debugOpportunities()[0];
    expect(opportunity?.status).toBe("STALE");
    expect(opportunity?.rejectionReason).toBe("STALE_ODDS");
  });

  it("money-back state across the whole cycle leaves one persisted option per scan", async () => {
    const store = createMemoryWorkerStore(["odds-api"]);
    await store.markSourceStatus("odds-api", "HEALTHY");

    const records = await persistFromEnvelope(store, "odds-api", [
      { book: "book-a", outcome: "OVER", odds: 2.2 },
      { book: "book-b", outcome: "UNDER", odds: 2.1 },
    ]);
    await ingest(store, "odds-api", records);

    const report = await runDetection(store, { now: Date.parse(RECEIVED_AT) });
    const persisted = store.debugOpportunities();
    // Every ARB scan is persisted (status VERIFIED_ARG / FRESH_ARG / STALE family),
    // never silently dropped and never duplicated.
    expect(persisted).toHaveLength(report.opportunities.length);
    expect(report.arbs).toBe(persisted.length);
  });
});

describe("Phase 17 integration regression: runScanCycle operator loop", () => {
  it("a full scan cycle polls, captures raw payload, normalizes, persists, detects, beats", async () => {
    const store = createMemoryWorkerStore(["mock"]);
    const cycle = await runScanCycle({
      provider: new MockProvider(() => RECEIVED_AT),
      store,
      workerName: "reg-worker",
    });

    expect(cycle.status).toBe("OK");
    expect(cycle.provider).toBe("mock");
    expect(cycle.collect.events).toBeGreaterThan(0);
    expect(cycle.collect.selections).toBeGreaterThan(0);
    expect(cycle.detection?.priced).toBeGreaterThan(0);
    expect(cycle.detection?.scans).toBeGreaterThan(0);
    expect(cycle.sourceStatus).toBe("HEALTHY");

    expect(store.debugRawPayloads()).toHaveLength(1);
    const heartbeats = store.debugHeartbeats();
    expect(heartbeats.some((beat) => beat.status === "HEALTHY")).toBe(true);
    // Reconciliation ran after detection (Phase 15).
    expect(cycle.history).toBeDefined();
  });
});