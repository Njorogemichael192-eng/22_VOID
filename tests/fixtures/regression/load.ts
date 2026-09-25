/** Deterministic seeded RNG (mulberry32) so batches reproduce across runs. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Synthetic priced-selection batch for load / candidate-generation regression
 * (Phase 17). Generates `events` deterministic football fixtures, each carrying
 * the full supported market taxonomy with one price group per bookmaker
 * rotation. Every `arbEveryN`-th event is forced to carry one genuine
 * underround complement so scans provably surface at least one ARB.
 */

export interface BatchLeg {
  id: string;
  eventId: string;
  family: string;
  marketType: string;
  period: string;
  participant?: string;
  line?: string;
  outcome: string;
  odds: number;
  bookmaker: string;
  observedAt: number;
  sourceUpdatedAt: string;
  eventConfidence: number;
  settlementConfidence: number;
  sourceStatus: "OK";
}

export interface BatchOptions {
  events: number;
  /** Emit an underround complement on every N-th event (0 disables). */
  arbEveryN?: number;
  /** Rounding applied to generated odds. */
  round?: number;
  seed?: number;
  /** Base ingestion instant; all prices are seconds before this. */
  baseTime?: string;
}

const BOOKS = ["book-a", "book-b", "book-c"] as const;

function roundTo(odds: number, precision: number): number {
  return Math.round(odds * precision) / precision;
}

export function buildRegressionBatch(options: BatchOptions): BatchLeg[] {
  const seed = options.seed ?? 42;
  const random = mulberry32(seed);
  const precision = options.round ?? 100;
  const baseMs = Date.parse(options.baseTime ?? "2026-09-20T12:00:00.000Z");
  const legs: BatchLeg[] = [];

  const add = (
    eventId: string,
    bookmaker: string,
    sequential: number,
    spec: {
      family: string;
      marketType: string;
      period: string;
      participant?: string;
      line?: string;
      outcome: string;
      odds: number;
    }
  ): void => {
    const observedAt = baseMs - 30_000 + sequential;
    legs.push({
      id: `${spec.family}:${spec.line ?? "-"}:${spec.outcome}:${eventId}:${bookmaker}`,
      eventId,
      family: spec.family,
      marketType: spec.marketType,
      period: spec.period,
      ...(spec.participant !== undefined ? { participant: spec.participant } : {}),
      ...(spec.line !== undefined ? { line: spec.line } : {}),
      outcome: spec.outcome,
      odds: spec.odds,
      bookmaker,
      observedAt,
      sourceUpdatedAt: new Date(observedAt).toISOString(),
      eventConfidence: 0.95,
      settlementConfidence: 0.95,
      sourceStatus: "OK",
    });
  };

  for (let event = 0; event < options.events; event += 1) {
    const eventId = `load-evt-${String(event).padStart(3, "0")}`;
    let sequential = 0;
    const bookmaker = (index: number): string => BOOKS[index % BOOKS.length]!;

    // Overround for ordinary events; sector the arb events to underround.
    const forceArb = options.arbEveryN !== undefined && options.arbEveryN > 0 && event % options.arbEveryN === 0;
    const overround = forceArb ? 0.975 : 1.07 + random() * 0.035;

    const twoWay = (
      family: string,
      marketType: string,
      period: string,
      line: string,
      outcomeA: string,
      outcomeB: string,
      base: number,
      participant?: "HOME" | "AWAY"
    ) => {
      const a = roundTo(base + (random() - 0.5) * 0.1, precision);
      const b = roundTo(1 / (overround - 1 / a), precision);
      add(eventId, bookmaker(sequential), sequential, {
        ...(participant !== undefined ? { family, marketType, period, participant, line, outcome: outcomeA, odds: a } : { family, marketType, period, line, outcome: outcomeA, odds: a }),
      });
      sequential += 1;
      add(eventId, bookmaker(sequential), sequential, {
        ...(participant !== undefined ? { family, marketType, period, participant, line, outcome: outcomeB, odds: b } : { family, marketType, period, line, outcome: outcomeB, odds: b }),
      });
      sequential += 1;
    };

    const threeWay = (family: string, marketType: string, period: string) => {
      const p1 = 0.35 + random() * 0.25;
      const p2 = 0.25 + random() * 0.25;
      const p3 = 0.3 + random() * 0.25;
      const total = p1 + p2 + p3;
      const r1 = (p1 / total) * overround;
      const r2 = (p2 / total) * overround;
      const r3 = (p3 / total) * overround;
      const o1 = roundTo(1 / r1, precision);
      const o2 = roundTo(1 / r2, precision);
      const o3 = roundTo(1 / r3, precision);
      add(eventId, bookmaker(sequential), sequential, { family, marketType, period, outcome: "HOME", odds: o1 });
      sequential += 1;
      add(eventId, bookmaker(sequential), sequential, { family, marketType, period, outcome: "DRAW", odds: o2 });
      sequential += 1;
      add(eventId, bookmaker(sequential), sequential, { family, marketType, period, outcome: "AWAY", odds: o3 });
      sequential += 1;
    };

    twoWay("MATCH_TOTAL", "STANDARD", "FULL_MATCH", "2.5", "OVER", "UNDER", 1.9);
    twoWay("MATCH_TOTAL", "STANDARD", "FULL_MATCH", "3.5", "OVER", "UNDER", 1.8);
    twoWay("TEAM_TOTAL", "STANDARD", "FULL_MATCH", "1.5", "OVER", "UNDER", 1.95, "HOME");
    twoWay("TEAM_TOTAL", "STANDARD", "FULL_MATCH", "2.5", "OVER", "UNDER", 1.85, "HOME");
    twoWay("TEAM_TOTAL", "STANDARD", "FULL_MATCH", "1.5", "OVER", "UNDER", 2.0, "AWAY");
    add(eventId, bookmaker(sequential), sequential, {
      family: "BTTS",
      marketType: "BTTS",
      period: "FULL_MATCH",
      outcome: "BTTS_YES",
      odds: 1.6,
    });
    sequential += 1;
    add(eventId, bookmaker(sequential), sequential, {
      family: "BTTS",
      marketType: "BTTS",
      period: "FULL_MATCH",
      outcome: "BTTS_NO",
      odds: 2.3,
    });
    sequential += 1;
    threeWay("MATCH_RESULT", "ONE_X_TWO", "FULL_MATCH");
  }

  return legs;
}

/** Reciprocal-sum heuristic — here only for load/audit assertions. */
export function reciprocalSum(odds: readonly number[]): number {
  return odds.reduce((sum, odd) => sum + 1 / odd, 0);
}