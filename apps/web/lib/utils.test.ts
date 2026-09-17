import { describe, expect, it } from "vitest";

import { cn } from "@/lib/utils";

describe("cn helper", () => {
  it("merges class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });

  it("resolves tailwind-merge conflicts", () => {
    expect(cn("p-4", "p-2")).toBe("p-2");
  });
});