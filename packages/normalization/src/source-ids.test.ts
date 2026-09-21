import { describe, expect, it } from "vitest";

import { SourceIdIndex, sourceIdKey } from "./source-ids";

describe("SourceIdIndex", () => {
  it("maps provider events to canonical events by key", () => {
    const index = new SourceIdIndex();
    index.register("odds-api", "oddsepl001", "odds-api:oddsepl001");
    index.register("parlay-api", "parlayepl001", "odds-api:oddsepl001");

    expect(index.lookup("odds-api", "oddsepl001")).toBe("odds-api:oddsepl001");
    expect(index.lookup("parlay-api", "parlayepl001")).toBe("odds-api:oddsepl001");
    expect(index.has("odds-api", "oddsepl001")).toBe(true);
    expect(index.has("unknown", "x")).toBe(false);

    const mappings = index.forCanonicalEvent("odds-api:oddsepl001");
    expect(mappings).toHaveLength(2);
    expect(
      mappings.some((m) => m.provider === "parlay-api" && m.sourceEventId === "parlayepl001")
    ).toBe(true);
  });

  it("groups provider scopes without collisions", () => {
    const index = new SourceIdIndex();
    index.register("odds-api", "epl001", "c1");
    index.register("parlay-api", "epl001", "c2");
    expect(index.lookup("odds-api", "epl001")).toBe("c1");
    expect(index.lookup("parlay-api", "epl001")).toBe("c2");
  });

  it("overwrites a binding on re-registration (idempotent refresh)", () => {
    const index = new SourceIdIndex();
    index.register("odds-api", "epl001", "c1");
    index.register("odds-api", "epl001", "c1");
    expect(index.has("odds-api", "epl001")).toBe(true);
    expect(index.forCanonicalEvent("c1")).toHaveLength(1);
  });

  it("builds stable snapshot records", () => {
    const index = new SourceIdIndex();
    index.register("odds-api", "aa", "c1");
    index.register("parlay-api", "bb", "c1");
    expect(index.snapshot()).toEqual([
      { provider: "odds-api", sourceEventId: "aa", canonicalEventId: "c1" },
      { provider: "parlay-api", sourceEventId: "bb", canonicalEventId: "c1" },
    ]);
  });

  it("formats source keys with a colon separator", () => {
    expect(sourceIdKey("odds-api", "oddsepl001")).toBe("odds-api:oddsepl001");
  });
});
