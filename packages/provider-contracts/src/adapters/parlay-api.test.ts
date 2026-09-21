import { MarketFamily, Participant } from "@22void/domain";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PARLAY_API_SOCCER_RAW } from "../../../../tests/fixtures/providers/raw-parlay-api";
import { ParlayApiProvider } from "./parlay-api";

function stubFetch(body: unknown, ok = true) {
  const impl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    void _url;
    void _init;
    return { ok, status: ok ? 200 : 401, json: async () => body };
  });
  vi.stubGlobal("fetch", impl);
  return impl;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ParlayApiProvider", () => {
  it("polls with X-API-Key header and translates the fixture", async () => {
    const fetchMock = stubFetch(PARLAY_API_SOCCER_RAW);
    const provider = new ParlayApiProvider({ apiKey: "parlay-secret" });

    const result = await provider.poll();
    const url = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(url).toContain("/v1/sports/soccer_epl/odds");
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBe("parlay-secret");

    expect(result.envelope.provider).toBe("parlay-api");
    expect(result.envelope.events).toHaveLength(1);
    const event = result.envelope.events[0];
    expect(event?.markets).toHaveLength(6);

    const teamTotals = event?.markets.find((m) => m.family === MarketFamily.TEAM_TOTAL);
    expect(teamTotals?.participant).toBe(Participant.HOME);
    expect(teamTotals?.line).toBe("1.5");

    const exact = event?.markets.find((m) => m.family === MarketFamily.EXACT_SCORE);
    expect(exact?.prices[0]?.selections[0]?.outcome).toBe("2-1");

    expect(result.rawPayload.endpoint).toBe("/v1/sports/soccer_epl/odds");
  });

  it("reports health against the meta markets catalogue", async () => {
    stubFetch({ markets: [] });
    const provider = new ParlayApiProvider({ apiKey: "parlay-secret" });
    const health = await provider.health();
    expect(health.provider).toBe("parlay-api");
    expect(health.reachable).toBe(true);
  });

  it("reports unreachable on auth failures", async () => {
    stubFetch(undefined, false);
    const provider = new ParlayApiProvider({ apiKey: "bad" });
    const health = await provider.health();
    expect(health.reachable).toBe(false);
  });
});
