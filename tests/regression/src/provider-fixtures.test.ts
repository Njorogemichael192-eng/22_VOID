import { EventStatus, MarketFamily, MarketType, Period, type MarketStructure } from "@22void/domain";
import {
  envelopeToCanonicalRecords,
  ODDS_API_MARKET_KEYS,
  PARLAY_API_MARKET_KEYS,
  providerEnvelopeSchema,
  translateProviderOdds,
} from "@22void/provider-contracts";
import { MarketNormalizer, marketIdentityKey, toStructure } from "@22void/normalization";
import { describe, expect, it } from "vitest";

import { ODDS_API_SOCCER_RAW } from "../../../tests/fixtures/providers/raw-odds-api.js";
import { PARLAY_API_SOCCER_RAW } from "../../../tests/fixtures/providers/raw-parlay-api.js";
import { marketNormalizationCases } from "../../../tests/fixtures/regression/index.js";

const RECEIVED_AT = "2026-11-20T18:30:00.000Z";

describe("Phase 17 provider-fixture regression: odds-api translation fixture", () => {
  it("translates the raw odds-api fixture into a validated provider envelope", () => {
    const translated = translateProviderOdds(
      ODDS_API_SOCCER_RAW,
      ODDS_API_MARKET_KEYS,
      "odds-api",
      "req-odds-api-001",
      RECEIVED_AT
    );
    expect(translated.events).toHaveLength(2);
    // player_goals_anytime is intentionally unregistered → skipped, never guessed.
    expect(translated.skippedOutcomes.some((skip) => skip.includes("player_goals_anytime"))).toBe(true);

    const envelope = providerEnvelopeSchema.parse(translated);
    expect(envelope.events).toHaveLength(2);

    const first = envelope.events[0]!;
    expect(first.homeTeam).toBe("Manchester City");
    expect(first.status).toBe(EventStatus.SCHEDULED);
    const families = new Set(first.markets.map((market) => market.family));
    expect(families.has(MarketFamily.MATCH_TOTAL)).toBe(true);
    expect(families.has(MarketFamily.MATCH_RESULT)).toBe(true);
    expect(families.has(MarketFamily.TEAM_TOTAL)).toBe(true);
    expect(families.has(MarketFamily.BTTS)).toBe(true);
    expect(families.has(MarketFamily.DOUBLE_CHANCE)).toBe(true);
    // Away team totals split into a home/away participant market.
    const teamTotal = first.markets.find((market) => market.family === MarketFamily.TEAM_TOTAL);
    expect(teamTotal?.participant).toBe("AWAY");
    expect(teamTotal?.line).toBe("1.5");
  });

  it("becomes canonical records with lines, splits and zero rejections", () => {
    const translated = translateProviderOdds(
      ODDS_API_SOCCER_RAW,
      ODDS_API_MARKET_KEYS,
      "odds-api",
      "req-odds-api-001",
      RECEIVED_AT
    );
    const envelope = providerEnvelopeSchema.parse(translated);
    const records = envelopeToCanonicalRecords(envelope);
    expect(records.events.length).toBe(2);
    expect(records.selections.length).toBeGreaterThan(0);
    expect(records.rejected).toHaveLength(0);

    for (const selection of records.selections) {
      expect(selection.odds).toBeGreaterThan(1);
      expect(selection.sourceUpdatedAt <= RECEIVED_AT).toBe(true);
    }
    const totalsOver = records.selections.find(
      (selection) =>
        selection.market.family === MarketFamily.MATCH_TOTAL &&
        selection.outcome === "OVER"
    );
    expect(totalsOver?.market.line).toBe("2.5");
  });

  it("maps live events through the status callback", () => {
    const translated = translateProviderOdds(
      ODDS_API_SOCCER_RAW,
      ODDS_API_MARKET_KEYS,
      "odds-api",
      "req-odds-api-002",
      RECEIVED_AT,
      undefined,
      (event) => (event.status === "live" ? EventStatus.LIVE : EventStatus.SCHEDULED)
    );
    const envelope = providerEnvelopeSchema.parse(translated);
    expect(envelope.events[1]!.status).toBe(EventStatus.LIVE);
  });
});

describe("Phase 17 provider-fixture regression: parlay-api translation fixture", () => {
  it("translates the raw parlay fixture and keeps only registered markets", () => {
    const translated = translateProviderOdds(
      PARLAY_API_SOCCER_RAW,
      PARLAY_API_MARKET_KEYS,
      "parlay-api",
      "req-parlay-001",
      RECEIVED_AT
    );
    const envelope = providerEnvelopeSchema.parse(translated);
    expect(envelope.events.length).toBeGreaterThan(0);
    const first = envelope.events[0]!;
    const families = new Set(first.markets.map((market) => market.family));
    expect(families.has(MarketFamily.MATCH_RESULT)).toBe(true);
  });
});

describe("Phase 17 provider-fixture regression: market normalization golden table", () => {
  const normalizer = new MarketNormalizer();

  it.each(marketNormalizationCases)("$id → matched=$expected.matched", (entry) => {
    const descriptor = {
      provider: "books",
      key: entry.key,
      sourceMarketId: entry.key,
      ...(entry.label !== undefined ? { label: entry.label } : {}),
      ...(entry.outcomes !== undefined ? { outcomes: entry.outcomes } : {}),
    };
    if (entry.expected.via === "key") {
      normalizer.addKey("books", entry.key, {
        family: MarketFamily.MATCH_TOTAL,
        marketType: MarketType.STANDARD,
        period: Period.FULL_MATCH,
      });
    }
    const result = normalizer.normalize(descriptor);
    expect(result.matched, entry.id).toBe(entry.expected.matched);
    if (!entry.expected.matched) {
      if (entry.expected.reasonContains !== undefined) {
        expect(result.reason, entry.id).toContain(entry.expected.reasonContains);
      }
      return;
    }
    const resolution = result.resolution!;
    if (entry.expected.family !== undefined) expect(resolution.family, entry.id).toBe(entry.expected.family);
    if (entry.expected.period !== undefined) expect(resolution.period, entry.id).toBe(entry.expected.period);
    if (entry.expected.marketType !== undefined) {
      expect(resolution.marketType, entry.id).toBe(entry.expected.marketType);
    }
    if (entry.expected.participant !== undefined) {
      expect(resolution.participant, entry.id).toBe(entry.expected.participant);
    }
    if (entry.expected.line !== undefined) expect(resolution.line, entry.id).toBe(entry.expected.line);
    if (entry.expected.via !== undefined) expect(resolution.via, entry.id).toBe(entry.expected.via);
  });

  it("equivalent labels normalize to the identical canonical structure key", () => {
    const fromGoals = normalizer.normalize({
      provider: "books",
      key: "goals",
      sourceMarketId: "m1",
      label: "Goals Over/Under",
      outcomes: [{ name: "Over 2.5" }, { name: "Under 2.5" }],
    });
    const fromTotal = normalizer.normalize({
      provider: "books",
      key: "totals",
      sourceMarketId: "m2",
      label: "Total Goals",
      outcomes: [{ name: "Over 2.5" }, { name: "Under 2.5" }],
    });
    expect(fromGoals.matched).toBe(true);
    expect(fromTotal.matched).toBe(true);
    expect(marketIdentityKey(fromGoals.resolution!)).toBe(marketIdentityKey(fromTotal.resolution!));
  });

  it("home team totals never collapse into match totals", () => {
    const home = normalizer.normalize({
      provider: "books",
      key: "team_totals_home",
      sourceMarketId: "m3",
      label: "Home Team Goals O/U",
      outcomes: [{ name: "Over 1.5" }, { name: "Under 1.5" }],
    });
    const match = normalizer.normalize({
      provider: "books",
      key: "totals",
      sourceMarketId: "m4",
      label: "Total Goals",
      outcomes: [{ name: "Over 2.5" }, { name: "Under 2.5" }],
    });
    expect(home.resolution?.family).toBe(MarketFamily.TEAM_TOTAL);
    expect(home.resolution?.participant).toBe("HOME");
    expect(marketIdentityKey(home.resolution!)).not.toBe(marketIdentityKey(match.resolution!));
  });

  it("matched resolutions form valid line-aware MarketStructure records", () => {
    for (const entry of marketNormalizationCases) {
      const result = normalizer.normalize({
        provider: "books",
        key: entry.key,
        sourceMarketId: entry.key,
        ...(entry.label !== undefined ? { label: entry.label } : {}),
        ...(entry.outcomes !== undefined ? { outcomes: entry.outcomes } : {}),
      });
      if (!result.matched) continue;
      const structure = toStructure(result.resolution!);
      expect(structure, entry.id).toBeDefined();
      expect((structure as MarketStructure | undefined)?.family).toBe(result.resolution?.family);
    }
  });
});