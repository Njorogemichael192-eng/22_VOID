import { MarketFamily, Period } from "@22void/domain";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EXAMPLE_SOCCER_RAW } from "../../../../tests/fixtures/providers/raw-example";
import { ExampleProvider } from "./example";

function stubFetch(body: unknown, ok = true) {
  const impl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    void _url;
    void _init;
    return { ok, status: ok ? 200 : 500, json: async () => body };
  });
  vi.stubGlobal("fetch", impl);
  return impl;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ExampleProvider", () => {
  it("polls credential-free and translates the fixture through the shared pipeline", async () => {
    const fetchMock = stubFetch(EXAMPLE_SOCCER_RAW);
    const provider = new ExampleProvider({ baseUrl: "http://127.0.0.1:4010" });

    const result = await provider.poll();

    const url = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(url).toContain("http://127.0.0.1:4010/odds");
    // Credential-free by design: no auth header on the reference adapter.
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBeUndefined();

    expect(result.envelope.provider).toBe("example");
    expect(result.envelope.events).toHaveLength(1);
    const event = result.envelope.events[0];
    expect(event?.markets).toHaveLength(2);

    const matchResult = event?.markets.find((m) => m.family === MarketFamily.MATCH_RESULT);
    expect(matchResult?.period).toBe(Period.FULL_MATCH);
    expect(matchResult?.prices[0]?.selections).toHaveLength(3);

    const totals = event?.markets.find((m) => m.family === MarketFamily.MATCH_TOTAL);
    expect(totals?.line).toBe("2.5");

    expect(result.rawPayload.provider).toBe("example");
    expect(result.rawPayload.endpoint).toBe("/odds?sport=soccer_epl");
  });

  it("honours a per-request sport, regions and markets override", async () => {
    const fetchMock = stubFetch(EXAMPLE_SOCCER_RAW);
    const provider = new ExampleProvider({ baseUrl: "http://127.0.0.1:4010" });

    await provider.poll({ sportKey: "soccer_la_liga", regions: "eu", markets: "h2h" });

    const url = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(url).toContain("sport=soccer_la_liga");
    expect(url).toContain("regions=eu");
    expect(url).toContain("markets=h2h");
  });

  it("reports reachable health from /health", async () => {
    stubFetch({ status: "ok" });
    const provider = new ExampleProvider({ baseUrl: "http://127.0.0.1:4010" });
    const health = await provider.health();
    expect(health.provider).toBe("example");
    expect(health.reachable).toBe(true);
  });

  it("reports unreachable when the feed answers an error", async () => {
    stubFetch(undefined, false);
    const provider = new ExampleProvider({ baseUrl: "http://127.0.0.1:4010" });
    const health = await provider.health();
    expect(health.reachable).toBe(false);
  });
});
