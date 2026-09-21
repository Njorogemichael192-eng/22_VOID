import { describe, expect, it } from "vitest";

import { canonicalEventSchema } from "./index.js";

const baseEvent = {
  canonicalEventId: "evt-0001",
  competition: "English Premier League",
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  startTime: "2026-10-03T19:00:00Z",
};

const validEvent = {
  ...baseEvent,
  sport: "football",
  status: "LIVE",
  sourceEventIds: [
    { provider: "provider-a", sourceEventId: "PA-482173" },
    { provider: "provider-b", sourceEventId: "PB-99120X" },
  ],
};

describe("canonicalEventSchema", () => {
  it("accepts a well-formed event", () => {
    expect(canonicalEventSchema.safeParse(validEvent).success).toBe(true);
  });

  it("defaults sport, status and sourceEventIds when omitted", () => {
    const parsed = canonicalEventSchema.parse(baseEvent);
    expect(parsed.sport).toBe("football");
    expect(parsed.status).toBe("SCHEDULED");
    expect(parsed.sourceEventIds).toEqual([]);
  });

  it("rejects a missing home team", () => {
    const { canonicalEventId, competition, awayTeam, startTime } = baseEvent;
    expect(
      canonicalEventSchema.safeParse({ canonicalEventId, competition, awayTeam, startTime }).success
    ).toBe(false);
  });

  it("rejects identical home and away teams", () => {
    expect(canonicalEventSchema.safeParse({ ...validEvent, awayTeam: "Arsenal" }).success).toBe(
      false
    );
  });

  it("rejects a non-ISO start time", () => {
    expect(canonicalEventSchema.safeParse({ ...validEvent, startTime: "tomorrow" }).success).toBe(
      false
    );
  });

  it("rejects an unknown status", () => {
    expect(canonicalEventSchema.safeParse({ ...validEvent, status: "PLAYED" }).success).toBe(false);
  });

  it("rejects duplicate source event ids per provider", () => {
    const sourceEventIds = [
      { provider: "provider-a", sourceEventId: "PA-1" },
      { provider: "provider-a", sourceEventId: "PA-1" },
    ];
    expect(canonicalEventSchema.safeParse({ ...validEvent, sourceEventIds }).success).toBe(false);
  });

  it("accepts the same sourceEventId under different providers", () => {
    const sourceEventIds = [
      { provider: "provider-a", sourceEventId: "PA-1" },
      { provider: "provider-b", sourceEventId: "PA-1" },
    ];
    expect(canonicalEventSchema.safeParse({ ...validEvent, sourceEventIds }).success).toBe(true);
  });
});
