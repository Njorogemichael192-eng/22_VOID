import { envelopeToCanonicalRecords, MockProvider } from "@22void/provider-contracts";
import { describe, expect, it } from "vitest";

import { normalizeRun } from "./normalize.js";
import { createMemoryWorkerStore } from "./store.js";

const NOW = "2026-09-21T12:00:00.000Z";

async function pollOnce() {
  const provider = new MockProvider(() => NOW);
  const result = await provider.poll();
  const records = envelopeToCanonicalRecords(result.envelope);
  return { provider, records };
}

describe("normalizeRun", () => {
  it("maps canonical records to a persistence run with identities and confidence", async () => {
    const { provider, records } = await pollOnce();
    const store = createMemoryWorkerStore([provider.providerKey]);

    const out = normalizeRun(provider.providerKey, records, await store.loadEventSeeds());

    expect(out.persist.events.length).toBe(2);
    expect(out.persist.markets.length).toBeGreaterThan(0);
    expect(out.persist.selections.length).toBeGreaterThan(0);
    expect(out.normalized).toHaveLength(2);

    for (const entry of out.normalized) {
      expect(entry.action).toBe("created");
      expect(entry.confidence).toBe(1);
    }
    for (const event of out.persist.events) {
      expect(event.sources[0]?.eventConfidence).toBe(1);
      expect(event.homeTeam).not.toBe(event.awayTeam);
    }
    for (const market of out.persist.markets) {
      // composite market identity never collides across events
      expect(market.sourceMarketId).toContain(":");
    }
  });

  it("merges a second poll into the same canonical events (no duplicates)", async () => {
    const provider = new MockProvider(() => NOW);
    const store = createMemoryWorkerStore([provider.providerKey]);

    const { records: firstRecords } = await pollOnce();
    const first = normalizeRun(provider.providerKey, firstRecords, []);
    await store.persistRun(first.persist);

    const { records: secondRecords } = await pollOnce();
    const second = normalizeRun(provider.providerKey, secondRecords, await store.loadEventSeeds());

    expect(second.normalized.every((entry) => entry.action === "merged")).toBe(true);
    expect(second.persist.events.length).toBe(first.persist.events.length);
    expect(second.persist.events.map((event) => event.canonicalEventId).sort()).toEqual(
      first.persist.events.map((event) => event.canonicalEventId).sort()
    );
  });
});