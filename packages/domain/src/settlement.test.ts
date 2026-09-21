import { describe, expect, it } from "vitest";

import {
  returnMultiplier,
  settlementResultFromComponents,
  settlementStateSchema,
} from "./index.js";

describe("settlementResultFromComponents", () => {
  it("maps the canonical quarter-line splits", () => {
    expect(settlementResultFromComponents(["WIN", "WIN"])).toBe("FULL_WIN");
    expect(settlementResultFromComponents(["WIN", "PUSH"])).toBe("HALF_WIN");
    expect(settlementResultFromComponents(["LOSS", "LOSS"])).toBe("FULL_LOSS");
    expect(settlementResultFromComponents(["PUSH", "LOSS"])).toBe("HALF_LOSS");
    expect(settlementResultFromComponents(["PUSH", "PUSH"])).toBe("PUSH");
    expect(settlementResultFromComponents(["VOID", "VOID"])).toBe("VOID");
  });

  it("throws on an empty component list", () => {
    expect(() => settlementResultFromComponents([])).toThrow();
  });

  it("throws on a WIN/LOSS mix without a canonical state", () => {
    expect(() => settlementResultFromComponents(["WIN", "LOSS"])).toThrow();
  });

  it("throws when VOID is mixed with other components", () => {
    expect(() => settlementResultFromComponents(["WIN", "VOID"])).toThrow();
  });
});

describe("settlementStateSchema", () => {
  it("accepts a simple state without components", () => {
    expect(settlementStateSchema.safeParse({ result: "FULL_WIN" }).success).toBe(true);
  });

  it("accepts a component state consistent with its result", () => {
    expect(
      settlementStateSchema.safeParse({ result: "HALF_LOSS", components: ["PUSH", "LOSS"] }).success
    ).toBe(true);
  });

  it("rejects a component state inconsistent with its result", () => {
    expect(
      settlementStateSchema.safeParse({ result: "FULL_WIN", components: ["WIN", "PUSH"] }).success
    ).toBe(false);
  });

  it("rejects an unknown result value", () => {
    expect(settlementStateSchema.safeParse({ result: "BIG_WIN" }).success).toBe(false);
  });
});

describe("returnMultiplier", () => {
  it("returns the decimal odds on a full win", () => {
    expect(returnMultiplier("FULL_WIN", 2.4)).toBe(2.4);
  });

  it("zeroes the stake on a full loss", () => {
    expect(returnMultiplier("FULL_LOSS", 2.4)).toBe(0);
  });

  it("returns half-stake on a half loss", () => {
    expect(returnMultiplier("HALF_LOSS", 2.4)).toBe(0.5);
  });

  it("returns (odds + 1) / 2 on a half win", () => {
    expect(returnMultiplier("HALF_WIN", 2.4)).toBe(1.7);
  });

  it("returns the full stake on push and void", () => {
    expect(returnMultiplier("PUSH", 2.4)).toBe(1);
    expect(returnMultiplier("VOID", 2.4)).toBe(1);
  });
});
