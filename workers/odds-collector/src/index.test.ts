import { describe, expect, it } from "vitest";
import { workerId } from "./index.js";

describe("@22void/odds-collector shell", () => {
  it("derives a worker id from the process", () => {
    expect(workerId()).toMatch(/^odds-collector-\d+$/);
  });
});