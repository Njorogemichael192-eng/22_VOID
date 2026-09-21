import { describe, expect, it } from "vitest";

import { OddsApiProvider, ParlayApiProvider, MockProvider, buildMockEnvelope } from "./index.js";
import { providerKeySchema } from "./provider-id.js";
import { providerEnvelopeSchema } from "./envelope.js";

describe("@22void/provider-contracts public API", () => {
  it("registers only extant provider keys", () => {
    expect(providerKeySchema.safeParse("mock").success).toBe(true);
    expect(providerKeySchema.safeParse("odds-api").success).toBe(true);
    expect(providerKeySchema.safeParse("parlay-api").success).toBe(true);
    expect(providerKeySchema.safeParse("betfair").success).toBe(false);
  });

  it("buildMockEnvelope produces a schema-valid envelope", () => {
    const envelope = buildMockEnvelope("2026-09-21T12:00:00.000Z", "mock-test-1");
    expect(providerEnvelopeSchema.safeParse(envelope).success).toBe(true);
    expect(envelope.provider).toBe("mock");
    expect(envelope.events.length).toBeGreaterThanOrEqual(2);
  });

  it("exposes provider classes", () => {
    expect(new MockProvider()).toBeInstanceOf(MockProvider);
    expect(new OddsApiProvider({ apiKey: "k" }).providerKey).toBe("odds-api");
    expect(new ParlayApiProvider({ apiKey: "k" }).providerKey).toBe("parlay-api");
  });
});
