import { describe, expect, it } from "vitest";

import {
  EventStatus,
  MarketFamily,
  MarketType,
  Participant,
  Period,
  SettlementResult,
} from "@22void/domain";

import { periodScore, settleSelection } from "./settle";
import type { MatchState, SettleAssessment, SettleCoreResult, SettleableSelection } from "./settle";

function finishedMatch(overrides: Partial<MatchState> = {}): MatchState {
  return {
    status: EventStatus.FINISHED,
    fullTime: null,
    firstHalf: null,
    secondHalf: null,
    extraTime: null,
    penalties: null,
    corners: null,
    cards: null,
    ...overrides,
  };
}

function fullTime(home: number, away: number): MatchState {
  return finishedMatch({ fullTime: { home, away } });
}

interface MarketOverrides {
  family?: MarketFamily;
  marketType?: MarketType;
  period?: Period;
  participant?: Participant;
  line?: string;
  outcome?: string;
}

function selection(overrides: MarketOverrides = {}): SettleableSelection {
  return {
    family: overrides.family ?? MarketFamily.MATCH_TOTAL,
    marketType: overrides.marketType ?? MarketType.STANDARD,
    period: overrides.period ?? Period.FULL_MATCH,
    outcome: overrides.outcome ?? "OVER",
    ...(overrides.participant !== undefined ? { participant: overrides.participant } : {}),
    ...(overrides.line !== undefined ? { line: overrides.line } : {}),
  };
}

function settled(result: SettleCoreResult): SettleAssessment {
  if (result.kind !== "settled")
    throw new Error(`expected settled, got ${result.kind}: ${JSON.stringify(result)}`);
  return result.assessment;
}

describe("standard totals (§11)", () => {
  it("Over 2.5 wins at T>=3, loses at T<=2", () => {
    const s = selection({ line: "2.5", outcome: "OVER" });
    expect(settled(settleSelection(s, fullTime(3, 0))).state.result).toBe(
      SettlementResult.FULL_WIN
    );
    expect(settled(settleSelection(s, fullTime(2, 0))).state.result).toBe(
      SettlementResult.FULL_LOSS
    );
    expect(settled(settleSelection(s, fullTime(10, 4))).state.result).toBe(
      SettlementResult.FULL_WIN
    );
  });

  it("Under 2.5 wins at T<=2, loses at T>=3 (exact complement)", () => {
    const s = selection({ line: "2.5", outcome: "UNDER" });
    expect(settled(settleSelection(s, fullTime(1, 1))).state.result).toBe(
      SettlementResult.FULL_WIN
    );
    expect(settled(settleSelection(s, fullTime(0, 3))).state.result).toBe(
      SettlementResult.FULL_LOSS
    );
  });
});

describe("whole Asian totals (§12)", () => {
  it("Over 2.0 pushes at exactly T=2", () => {
    const s = selection({
      family: MarketFamily.ASIAN_TOTAL,
      marketType: MarketType.ASIAN,
      line: "2.0",
      outcome: "OVER",
    });
    expect(settled(settleSelection(s, fullTime(2, 0))).state.result).toBe(SettlementResult.PUSH);
    expect(settled(settleSelection(s, fullTime(0, 1))).state.result).toBe(
      SettlementResult.FULL_LOSS
    );
    expect(settled(settleSelection(s, fullTime(1, 2))).state.result).toBe(
      SettlementResult.FULL_WIN
    );
  });

  it("Under 2.0 pushes at exactly T=2", () => {
    const s = selection({
      family: MarketFamily.ASIAN_TOTAL,
      marketType: MarketType.ASIAN,
      line: "2.0",
      outcome: "UNDER",
    });
    expect(settled(settleSelection(s, fullTime(2, 0))).state.result).toBe(SettlementResult.PUSH);
    expect(settled(settleSelection(s, fullTime(0, 1))).state.result).toBe(
      SettlementResult.FULL_WIN
    );
  });
});

describe("quarter Asian totals (§13)", () => {
  it("Over 2.25 → 50% Over 2.0 + 50% Over 2.5", () => {
    const s = selection({
      family: MarketFamily.ASIAN_TOTAL,
      marketType: MarketType.ASIAN,
      line: "2.25",
      outcome: "OVER",
    });
    expect(settled(settleSelection(s, fullTime(3, 0))).state.result).toBe(
      SettlementResult.FULL_WIN
    );
    expect(settled(settleSelection(s, fullTime(2, 0))).state.result).toBe(
      SettlementResult.HALF_LOSS
    );
    expect(settled(settleSelection(s, fullTime(0, 1))).state.result).toBe(
      SettlementResult.FULL_LOSS
    );
  });

  it("Over 2.75 → 50% Over 2.5 + 50% Over 3.0", () => {
    const s = selection({
      family: MarketFamily.ASIAN_TOTAL,
      marketType: MarketType.ASIAN,
      line: "2.75",
      outcome: "OVER",
    });
    expect(settled(settleSelection(s, fullTime(0, 2))).state.result).toBe(
      SettlementResult.FULL_LOSS
    );
    expect(settled(settleSelection(s, fullTime(3, 0))).state.result).toBe(
      SettlementResult.HALF_WIN
    );
    expect(settled(settleSelection(s, fullTime(2, 2))).state.result).toBe(
      SettlementResult.FULL_WIN
    );
  });

  it("Under 2.25 → 50% Under 2.0 + 50% Under 2.5", () => {
    const s = selection({
      family: MarketFamily.ASIAN_TOTAL,
      marketType: MarketType.ASIAN,
      line: "2.25",
      outcome: "UNDER",
    });
    expect(settled(settleSelection(s, fullTime(2, 0))).state.result).toBe(
      SettlementResult.HALF_WIN
    );
    expect(settled(settleSelection(s, fullTime(2, 1))).state.result).toBe(
      SettlementResult.FULL_LOSS
    );
  });

  it("reports the component split in notes", () => {
    const s = selection({
      family: MarketFamily.ASIAN_TOTAL,
      marketType: MarketType.ASIAN,
      line: "2.25",
      outcome: "OVER",
    });
    const result = settleSelection(s, fullTime(2, 0));
    expect(result.kind).toBe("settled");
    if (result.kind === "settled") {
      expect(result.assessment.notes.join(" ")).toContain("2");
      expect(result.assessment.state.components).toEqual(["PUSH", "LOSS"]);
    }
  });
});

describe("asian handicap (§14)", () => {
  it("Home −0.75: win by 1 → HALF_WIN (component −0.5 WIN + −1.0 PUSH)", () => {
    const s = selection({
      family: MarketFamily.ASIAN_HANDICAP,
      marketType: MarketType.HANDICAP,
      participant: Participant.HOME,
      line: "-0.75",
      outcome: "HOME",
    });
    expect(settled(settleSelection(s, fullTime(1, 0))).state.result).toBe(
      SettlementResult.HALF_WIN
    );
    expect(settled(settleSelection(s, fullTime(2, 0))).state.result).toBe(
      SettlementResult.FULL_WIN
    );
    expect(settled(settleSelection(s, fullTime(0, 0))).state.result).toBe(
      SettlementResult.FULL_LOSS
    );
  });

  it("Home −1.0: win by exactly 1 pushes", () => {
    const s = selection({
      family: MarketFamily.ASIAN_HANDICAP,
      marketType: MarketType.HANDICAP,
      participant: Participant.HOME,
      line: "-1.0",
      outcome: "HOME",
    });
    expect(settled(settleSelection(s, fullTime(1, 0))).state.result).toBe(SettlementResult.PUSH);
    expect(settled(settleSelection(s, fullTime(2, 1))).state.result).toBe(SettlementResult.PUSH);
    expect(settled(settleSelection(s, fullTime(2, 0))).state.result).toBe(
      SettlementResult.FULL_WIN
    );
    expect(settled(settleSelection(s, fullTime(0, 0))).state.result).toBe(
      SettlementResult.FULL_LOSS
    );
  });

  it("Home +0.25 on a draw → HALF_WIN (0.0 PUSH + 0.5 WIN)", () => {
    const s = selection({
      family: MarketFamily.ASIAN_HANDICAP,
      marketType: MarketType.HANDICAP,
      participant: Participant.HOME,
      line: "0.25",
      outcome: "HOME",
    });
    expect(settled(settleSelection(s, fullTime(1, 1))).state.result).toBe(
      SettlementResult.HALF_WIN
    );
    expect(settled(settleSelection(s, fullTime(0, 1))).state.result).toBe(
      SettlementResult.FULL_LOSS
    );
  });

  it("Away +0.75: away win by 1 → FULL_WIN (0.5 and 1.0 both cover)", () => {
    const s = selection({
      family: MarketFamily.ASIAN_HANDICAP,
      marketType: MarketType.HANDICAP,
      participant: Participant.AWAY,
      line: "0.75",
      outcome: "AWAY",
    });
    expect(settled(settleSelection(s, fullTime(0, 1))).state.result).toBe(
      SettlementResult.FULL_WIN
    );
    expect(settled(settleSelection(s, fullTime(1, 1))).state.result).toBe(
      SettlementResult.FULL_WIN
    );
    expect(settled(settleSelection(s, fullTime(2, 0))).state.result).toBe(
      SettlementResult.FULL_LOSS
    );
  });
});

describe("1X2 and double chance", () => {
  it("settles 1X2 from the goal margin", () => {
    const base = {
      family: MarketFamily.MATCH_RESULT,
      marketType: MarketType.ONE_X_TWO,
      period: Period.FULL_MATCH,
    } as const;
    const home = settleSelection({ ...base, outcome: "HOME" }, fullTime(2, 1));
    const draw = settleSelection({ ...base, outcome: "DRAW" }, fullTime(1, 1));
    const away = settleSelection({ ...base, outcome: "AWAY" }, fullTime(0, 1));
    expect(settled(home).state.result).toBe(SettlementResult.FULL_WIN);
    expect(settled(draw).state.result).toBe(SettlementResult.FULL_WIN);
    expect(settled(away).state.result).toBe(SettlementResult.FULL_WIN);
    expect(
      settled(settleSelection({ ...base, outcome: "HOME" }, fullTime(1, 2))).state.result
    ).toBe(SettlementResult.FULL_LOSS);
  });

  it("settles double chance (draw covers)", () => {
    const base = {
      family: MarketFamily.DOUBLE_CHANCE,
      marketType: MarketType.DOUBLE_CHANCE,
      period: Period.FULL_MATCH,
    } as const;
    expect(
      settled(settleSelection({ ...base, outcome: "HOME_OR_DRAW" }, fullTime(2, 1))).state.result
    ).toBe(SettlementResult.FULL_WIN);
    expect(
      settled(settleSelection({ ...base, outcome: "HOME_OR_DRAW" }, fullTime(1, 1))).state.result
    ).toBe(SettlementResult.FULL_WIN);
    expect(
      settled(settleSelection({ ...base, outcome: "HOME_OR_DRAW" }, fullTime(0, 1))).state.result
    ).toBe(SettlementResult.FULL_LOSS);
    expect(
      settled(settleSelection({ ...base, outcome: "HOME_OR_AWAY" }, fullTime(1, 1))).state.result
    ).toBe(SettlementResult.FULL_LOSS);
  });
});

describe("BTTS", () => {
  it("settles both-teams-to-score from both sides scoring", () => {
    const base = {
      family: MarketFamily.BTTS,
      marketType: MarketType.BTTS,
      period: Period.FULL_MATCH,
    } as const;
    expect(
      settled(settleSelection({ ...base, outcome: "BTTS_YES" }, fullTime(1, 1))).state.result
    ).toBe(SettlementResult.FULL_WIN);
    expect(
      settled(settleSelection({ ...base, outcome: "BTTS_YES" }, fullTime(1, 0))).state.result
    ).toBe(SettlementResult.FULL_LOSS);
    expect(
      settled(settleSelection({ ...base, outcome: "BTTS_NO" }, fullTime(1, 0))).state.result
    ).toBe(SettlementResult.FULL_WIN);
    expect(
      settled(settleSelection({ ...base, outcome: "BTTS_NO" }, fullTime(2, 2))).state.result
    ).toBe(SettlementResult.FULL_LOSS);
  });
});

describe("exact score", () => {
  it("wins only on the exact scoreline", () => {
    const base = {
      family: MarketFamily.EXACT_SCORE,
      marketType: MarketType.EXACT_SCORE,
      period: Period.FULL_MATCH,
    } as const;
    expect(settled(settleSelection({ ...base, outcome: "2-1" }, fullTime(2, 1))).state.result).toBe(
      SettlementResult.FULL_WIN
    );
    expect(settled(settleSelection({ ...base, outcome: "2-1" }, fullTime(1, 2))).state.result).toBe(
      SettlementResult.FULL_LOSS
    );
  });

  it("rejects malformed scorelines", () => {
    const base = {
      family: MarketFamily.EXACT_SCORE,
      marketType: MarketType.EXACT_SCORE,
      period: Period.FULL_MATCH,
    } as const;
    const result = settleSelection({ ...base, outcome: "2-1-3" }, fullTime(2, 1));
    expect(result.kind).toBe("unknown");
    if (result.kind === "unknown") expect(result.reason).toContain("exact-score");
  });
});

describe("team totals", () => {
  it("settles a home team total from the home goals", () => {
    const s = selection({
      family: MarketFamily.TEAM_TOTAL,
      marketType: MarketType.STANDARD,
      participant: Participant.HOME,
      line: "1.5",
      outcome: "OVER",
    });
    expect(settled(settleSelection(s, fullTime(2, 0))).state.result).toBe(
      SettlementResult.FULL_WIN
    );
    expect(settled(settleSelection(s, fullTime(1, 4))).state.result).toBe(
      SettlementResult.FULL_LOSS
    );
  });

  it("settles a quarter team Asian total", () => {
    const s = selection({
      family: MarketFamily.TEAM_ASIAN_TOTAL,
      marketType: MarketType.ASIAN,
      participant: Participant.HOME,
      line: "2.25",
      outcome: "OVER",
    });
    // home 2 → component 2.0 PUSH + 2.5 LOSS = HALF_LOSS
    expect(settled(settleSelection(s, fullTime(2, 3))).state.result).toBe(
      SettlementResult.HALF_LOSS
    );
  });

  it("rejects team totals without a participant", () => {
    const s = selection({
      family: MarketFamily.TEAM_TOTAL,
      marketType: MarketType.STANDARD,
      line: "1.5",
      outcome: "OVER",
    });
    const result = settleSelection(s, fullTime(2, 0));
    expect(result.kind).toBe("unknown");
    if (result.kind === "unknown") expect(result.reason).toContain("participant");
  });
});

describe("corners and cards", () => {
  it("settles corners over/under on the corner total", () => {
    const s = selection({
      family: MarketFamily.CORNERS,
      marketType: MarketType.STANDARD,
      line: "10.5",
      outcome: "OVER",
    });
    const match = finishedMatch({ corners: { home: 8, away: 3 } });
    expect(settled(settleSelection(s, match)).state.result).toBe(SettlementResult.FULL_WIN);
    const undermatches = finishedMatch({ corners: { home: 5, away: 5 } });
    expect(settled(settleSelection(s, undermatches)).state.result).toBe(SettlementResult.FULL_LOSS);
  });

  it("settles cards over/under on the card total", () => {
    const s = selection({
      family: MarketFamily.CARDS,
      marketType: MarketType.STANDARD,
      line: "5.5",
      outcome: "UNDER",
    });
    const match = finishedMatch({ cards: { home: 3, away: 2 } });
    expect(settled(settleSelection(s, match)).state.result).toBe(SettlementResult.FULL_WIN);
  });

  it("rejects a corners market without corner data", () => {
    const s = selection({
      family: MarketFamily.CORNERS,
      marketType: MarketType.STANDARD,
      line: "10.5",
      outcome: "OVER",
    });
    const result = settleSelection(s, finishedMatch());
    expect(result.kind).toBe("unknown");
    if (result.kind === "unknown") expect(result.reason).toContain("corner");
  });
});

describe("period settlement", () => {
  it("settles first-half markets on the first-half score", () => {
    const match = finishedMatch({
      firstHalf: { home: 1, away: 1 },
      fullTime: { home: 0, away: 0 },
    });
    const s = selection({ period: Period.FIRST_HALF, line: "1.5", outcome: "OVER" });
    expect(settled(settleSelection(s, match)).state.result).toBe(SettlementResult.FULL_WIN);
  });

  it("derives the second-half score from full time minus first half", () => {
    const match = finishedMatch({
      firstHalf: { home: 1, away: 1 },
      fullTime: { home: 2, away: 1 },
    });
    const s = selection({ period: Period.SECOND_HALF, line: "2.5", outcome: "UNDER" });
    // second half 1-0 → total 1 < 2.5
    expect(settled(settleSelection(s, match)).state.result).toBe(SettlementResult.FULL_WIN);
    expect(periodScore(match, Period.SECOND_HALF)).toEqual({ home: 1, away: 0 });
  });

  it("honours an explicit second-half score when provided", () => {
    const match = finishedMatch({
      secondHalf: { home: 3, away: 0 },
      fullTime: { home: 4, away: 1 },
    });
    const s = selection({ period: Period.SECOND_HALF, line: "2.5", outcome: "OVER" });
    expect(settled(settleSelection(s, match)).state.result).toBe(SettlementResult.FULL_WIN);
  });

  it("settles extra-time totals on the extra-time score", () => {
    const match = finishedMatch({
      fullTime: { home: 1, away: 1 },
      extraTime: { home: 2, away: 1 },
    });
    const s = selection({ period: Period.EXTRA_TIME, line: "2.5", outcome: "OVER" });
    expect(settled(settleSelection(s, match)).state.result).toBe(SettlementResult.FULL_WIN);
  });

  it("rejects a market whose period state is missing", () => {
    const match = finishedMatch({ fullTime: { home: 1, away: 1 } });
    const s = selection({ period: Period.FIRST_HALF, line: "2.5", outcome: "OVER" });
    const result = settleSelection(s, match);
    expect(result.kind).toBe("unknown");
    if (result.kind === "unknown") expect(result.reason).toContain("missing FIRST_HALF");
  });
});

describe("void and unfinished events", () => {
  it("voids cancelled, abandoned and postponed events", () => {
    for (const status of [EventStatus.CANCELLED, EventStatus.ABANDONED, EventStatus.POSTPONED]) {
      const s = selection({ line: "2.5", outcome: "OVER" });
      const result = settled(settleSelection(s, finishedMatch({ status })));
      expect(result.state.result).toBe(SettlementResult.VOID);
      expect(result.state.components).toEqual(["VOID"]);
    }
  });

  it("rejects settlement while the event is not finished", () => {
    const s = selection({ line: "2.5", outcome: "OVER" });
    for (const status of [EventStatus.SCHEDULED, EventStatus.LIVE, EventStatus.UNKNOWN]) {
      const result = settleSelection(s, finishedMatch({ status }));
      expect(result.kind).toBe("unknown");
    }
  });
});

describe("line requirements and rejection (Rule 3)", () => {
  it("rejects totals without a line", () => {
    const s = selection({ outcome: "OVER" });
    const result = settleSelection(s, fullTime(3, 0));
    expect(result.kind).toBe("unknown");
  });

  it("rejects invalid line strings", () => {
    const s = selection({ line: "+2.5", outcome: "OVER" });
    const result = settleSelection(s, fullTime(3, 0));
    expect(result.kind).toBe("unknown");
  });

  it("rejects unsupported outcomes instead of guessing", () => {
    const base = {
      family: MarketFamily.MATCH_RESULT,
      marketType: MarketType.ONE_X_TWO,
      period: Period.FULL_MATCH,
    } as const;
    const result = settleSelection({ ...base, outcome: "FANCY" }, fullTime(1, 0));
    expect(result.kind).toBe("unknown");
    if (result.kind === "unknown") expect(result.reason).toContain("unsupported outcome");
  });
});
