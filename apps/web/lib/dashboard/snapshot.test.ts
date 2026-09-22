import { describe, expect, it } from "vitest";

import { getDashboardSnapshot } from "./snapshot";
import { createDemoRepo } from "./demo-repo";

const NOW = Date.parse("2026-09-22T12:00:00.000Z");

describe("getDashboardSnapshot", () => {
  it("collects verified opportunities, providers and scanner summary", async () => {
    const snapshot = await getDashboardSnapshot(createDemoRepo(NOW), NOW);
    expect(snapshot.verified.every((opp) => opp.status === "VERIFIED_ARB")).toBe(true);
    expect(snapshot.verified.length).toBeGreaterThanOrEqual(2);
    expect(snapshot.recent.length).toBeGreaterThanOrEqual(5);
    expect(snapshot.providers.length).toBeGreaterThanOrEqual(3);
    expect(snapshot.scanner.status).toBe("HEALTHY");
    expect(snapshot.scanner.stale).toBeNull();
    expect(snapshot.generatedAt).toBe(NOW);
  });
});
