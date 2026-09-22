import { describe, expect, it } from "vitest";

import { buildDemoSeed, createDemoRepo } from "./demo-repo";

const NOW = Date.parse("2026-09-22T12:00:00.000Z");

describe("demo seed", () => {
  it("holds deterministic fixtures for every view", () => {
    const seed = buildDemoSeed(NOW);
    expect(seed.events.length).toBeGreaterThanOrEqual(4);
    expect(seed.markets.length).toBeGreaterThanOrEqual(6);
    expect(seed.opportunities.some((opp) => opp.status === "VERIFIED_ARB")).toBe(true);
    expect(seed.opportunities.some((opp) => opp.status === "REJECTED")).toBe(true);
    expect(seed.opportunities.some((opp) => opp.status === "THEORETICAL_ARB")).toBe(true);
    expect(seed.providers.length).toBeGreaterThanOrEqual(3);
    expect(seed.scannerRuns.length).toBeGreaterThanOrEqual(2);
    expect(seed.adminSources.length).toBe(seed.providers.length);
  });

  it("keeps legs consistent with the stated return", () => {
    const seed = buildDemoSeed(NOW);
    const verified = seed.opportunities.find((opp) => opp.id === "opp_verified_totals");
    expect(verified?.totalStake).toBe(100);
    expect(verified?.minReturn).toBe(105);
    for (const leg of verified?.legs ?? []) {
      expect(Math.abs((leg.stake ?? 0) * leg.oddsSnapshot - 105)).toBeLessThan(0.01);
    }
  });
});

describe("demo repo", () => {
  it("lists opportunities filtered by status", async () => {
    const repo = createDemoRepo(NOW);
    const verified = await repo.listOpportunities({
      status: "VERIFIED_ARB",
      cursor: null,
      limit: 50,
    });
    expect(verified.data.every((opp) => opp.status === "VERIFIED_ARB")).toBe(true);
    expect(verified.data.length).toBe(2);
  });

  it("paginates events by opaque cursor", async () => {
    const repo = createDemoRepo(NOW);
    const first = await repo.listEvents({ cursor: null, limit: 2 });
    expect(first.data).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await repo.listEvents({ cursor: first.nextCursor, limit: 2 });
    expect(second.data).toHaveLength(2);
    const ids = new Set([...first.data, ...second.data].map((event) => event.id));
    expect(ids.size).toBe(4);
  });

  it("returns a null cursor on the last page", async () => {
    const repo = createDemoRepo(NOW);
    const page = await repo.listEvents({ cursor: null, limit: 100 });
    expect(page.nextCursor).toBeNull();
  });

  it("filters events by team and competition", async () => {
    const repo = createDemoRepo(NOW);
    const byTeam = await repo.listEvents({ team: "arsenal", cursor: null, limit: 50 });
    expect(byTeam.data.every((event) => event.homeTeam === "Arsenal")).toBe(true);
    const byCompetition = await repo.listEvents({
      competition: "Serie A",
      cursor: null,
      limit: 50,
    });
    expect(byCompetition.data[0]?.competition).toBe("Serie A");
  });

  it("resolves detail views by id and nulls for unknowns", async () => {
    const repo = createDemoRepo(NOW);
    expect((await repo.getEvent("evt_ars_che"))?.homeTeam).toBe("Arsenal");
    expect(await repo.getEvent("nope")).toBeNull();
    expect(await repo.getOpportunity("opp_verified_totals")).not.toBeNull();
    expect(await repo.getOpportunity("nope")).toBeNull();
    const market = await repo.getMarket("mkt_ars_total");
    expect(market?.odds.length).toBeGreaterThanOrEqual(2);
  });

  it("returns markets with their odds attached", async () => {
    const repo = createDemoRepo(NOW);
    const page = await repo.listMarkets({
      eventId: "evt_ars_che",
      family: "MATCH_TOTAL",
      cursor: null,
      limit: 50,
    });
    expect(page.data).toHaveLength(1);
    expect(page.data[0]?.odds.some((odds) => odds.bookmaker === "Bet365")).toBe(true);
  });

  it("serves providers and scanner runs", async () => {
    const repo = createDemoRepo(NOW);
    const providers = await repo.listProviders();
    expect(providers[0]).toMatchObject({ status: "HEALTHY" });
    const runs = await repo.listScannerRuns(10);
    expect(runs[0]?.status).toBe("HEALTHY");
  });
});
