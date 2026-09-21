import { MarketFamily, Participant } from "@22void/domain";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ODDS_API_SOCCER_RAW } from "../../../../tests/fixtures/providers/raw-odds-api";
import { OddsApiProvider } from "./odds-api";
import { ProviderTransportError } from "../providers/http";

function stubFetch(body: unknown, ok = true, status = 200) {
  const impl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    void _url;
    void _init;
    return { ok, status, json: async () => body };
  });
  vi.stubGlobal("fetch", impl);
  return impl;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OddsApiProvider", () => {
  it("polls a wire body into a canonical envelope with raw payload", async () => {
    const fetchMock = stubFetch(ODDS_API_SOCCER_RAW);
    const provider = new OddsApiProvider({ apiKey: "test-key" });

    const result = await provider.poll();
    const url = decodeURIComponent(String(fetchMock.mock.calls[0]?.[0] ?? ""));
    expect(url).toContain("/v4/sports/soccer_epl/odds");
    expect(url).toContain("apiKey=test-key");
    expect(url).toContain("regions=uk,eu");
    expect(url).toContain("markets=h2h,totals");
    expect(url).toContain("oddsFormat=decimal");

    expect(result.envelope.provider).toBe("odds-api");
    expect(result.envelope.requestId).toBeDefined();
    expect(result.envelope.receivedAt).toBeDefined();
    expect(result.envelope.events).toHaveLength(2);

    const teamTotals = result.envelope.events[0]?.markets.find(
      (m) => m.family === MarketFamily.TEAM_TOTAL
    );
    expect(teamTotals?.participant).toBe(Participant.AWAY);

    expect(result.rawPayload.provider).toBe("odds-api");
    expect(result.rawPayload.endpoint).toBe("/v4/sports/soccer_epl/odds");
    expect(result.rawPayload.payload).toEqual(ODDS_API_SOCCER_RAW);
  });

  it("flags a live wire event as LIVE", async () => {
    stubFetch(ODDS_API_SOCCER_RAW);
    const provider = new OddsApiProvider({ apiKey: "test-key" });
    const result = await provider.poll();
    expect(result.envelope.events[1]?.status).toBe("LIVE");
  });

  it("throws a transport error carrying the HTTP status", async () => {
    stubFetch(null, false, 429);
    const provider = new OddsApiProvider({ apiKey: "test-key" });
    await expect(provider.poll()).rejects.toSatisfy(
      (error: unknown) => error instanceof ProviderTransportError && error.status === 429
    );
  });

  it("reports health from the sports catalogue endpoint", async () => {
    stubFetch([]);
    const provider = new OddsApiProvider({ apiKey: "test-key" });
    const health = await provider.health();
    expect(health.provider).toBe("odds-api");
    expect(health.reachable).toBe(true);
    expect(health.checkedAt).toBeDefined();
  });

  it("reports unreachable when the health probe fails", async () => {
    stubFetch(null, false, 500);
    const provider = new OddsApiProvider({ apiKey: "test-key" });
    const health = await provider.health();
    expect(health.reachable).toBe(false);
  });

  it("supports overriding sports, regions and markets via request", async () => {
    const fetchMock = stubFetch([ODDS_API_SOCCER_RAW[0]!]);
    const provider = new OddsApiProvider({
      apiKey: "test-key",
      regions: "eu",
      markets: "h2h_1st_half,totals_1st_half",
      defaultSportKey: "soccer_pl",
    });
    await provider.poll({ sportKey: "soccer_spain_la_liga", regions: "us2,eu", markets: "h2h" });
    const url = decodeURIComponent(String(fetchMock.mock.calls[0]?.[0] ?? ""));
    expect(url).toContain("/v4/sports/soccer_spain_la_liga/odds");
    expect(url).toContain("regions=us2,eu");
    expect(url).toContain("markets=h2h");
  });
});
