import { describe, expect, it } from "vitest";
import { RejectionReason } from "@22void/domain";
import type { RejectionVerdict } from "./index.js";

describe("@22void/arbitrage skeleton", () => {
  it("exposes the rejection verdict shape", () => {
    const verdict: RejectionVerdict = {
      reason: RejectionReason.BOTH_LOSS_STATE,
      evidence: { homeGoals: 7, awayGoals: 4 },
    };
    expect(verdict.reason).toBe("BOTH_LOSS_STATE");
  });
});