import { describe, expect, it } from "vitest";
import type { ProviderHealth } from "./index.js";

describe("@22void/provider-contracts skeleton", () => {
  it("exposes the provider envelope types", () => {
    const health: ProviderHealth = { provider: "mock", reachable: true };
    expect(health.reachable).toBe(true);
  });
});