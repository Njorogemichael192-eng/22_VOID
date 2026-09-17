import { describe, expect, it } from "vitest";
import type { DbHealth } from "./index.js";

describe("@22void/db skeleton", () => {
  it("exposes the DB health shape", () => {
    const health: DbHealth = { reachable: false };
    expect(health.reachable).toBe(false);
  });
});