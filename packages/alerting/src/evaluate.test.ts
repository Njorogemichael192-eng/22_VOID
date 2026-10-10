import { describe, expect, it } from "vitest";

import { EMPTY_ALERT_STATE, evaluateHealthAlerts } from "./evaluate.js";
import type { HealthLevel, HealthSnapshot } from "./types.js";

function snapshot(
  at: number,
  cycle: HealthLevel,
  sources: ReadonlyArray<{ key: string; status: HealthLevel }> = []
): HealthSnapshot {
  return {
    at,
    cycle: { status: cycle, at },
    sources: sources.map((source) => ({ key: source.key, status: source.status, at })),
  };
}

describe("evaluateHealthAlerts", () => {
  it("fires once on the transition into an unhealthy level and not again while it persists", () => {
    let state = EMPTY_ALERT_STATE;

    let result = evaluateHealthAlerts(snapshot(1_000, "HEALTHY"), state);
    expect(result.events).toHaveLength(0);
    state = result.next;

    result = evaluateHealthAlerts(snapshot(2_000, "DOWN"), state);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      id: "cycle",
      code: "WORKER_DOWN",
      scope: "cycle",
      state: "FIRING",
      severity: "critical",
      status: "DOWN",
      since: 2_000,
    });
    state = result.next;

    result = evaluateHealthAlerts(snapshot(3_000, "DOWN"), state);
    expect(result.events).toHaveLength(0);
    state = result.next;

    result = evaluateHealthAlerts(snapshot(4_000, "HEALTHY"), state);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      id: "cycle",
      state: "RESOLVED",
      previousStatus: "DOWN",
      since: 2_000,
    });
    state = result.next;

    result = evaluateHealthAlerts(snapshot(5_000, "HEALTHY"), state);
    expect(result.events).toHaveLength(0);
  });

  it("requires consecutive unhealthy observations before firing", () => {
    const policy = { minSeverity: "info", renotifyMs: 0, hysteresis: 2 } as const;
    let state = EMPTY_ALERT_STATE;

    let result = evaluateHealthAlerts(snapshot(1_000, "DEGRADED"), state, policy);
    expect(result.events).toHaveLength(0);
    state = result.next;

    // A healthy observation resets the streak, so a single bad cycle is not an incident.
    result = evaluateHealthAlerts(snapshot(1_500, "HEALTHY"), state, policy);
    expect(result.events).toHaveLength(0);
    state = result.next;

    result = evaluateHealthAlerts(snapshot(2_000, "DEGRADED"), state, policy);
    expect(result.events).toHaveLength(0);
    state = result.next;

    result = evaluateHealthAlerts(snapshot(2_500, "DEGRADED"), state, policy);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.since).toBe(2_000);
  });

  it("re-notifies an unchanged condition only after the cooldown", () => {
    const policy = { minSeverity: "info", renotifyMs: 1_000, hysteresis: 1 } as const;
    let state = EMPTY_ALERT_STATE;

    let result = evaluateHealthAlerts(snapshot(1_000, "DEGRADED"), state, policy);
    expect(result.events).toHaveLength(1);
    state = result.next;

    result = evaluateHealthAlerts(snapshot(1_500, "DEGRADED"), state, policy);
    expect(result.events).toHaveLength(0);
    state = result.next;

    result = evaluateHealthAlerts(snapshot(2_500, "DEGRADED"), state, policy);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ state: "FIRING", since: 1_000 });
  });

  it("escalates immediately when a firing condition worsens", () => {
    const policy = { minSeverity: "warning", renotifyMs: 10_000, hysteresis: 1 } as const;
    let state = EMPTY_ALERT_STATE;

    let result = evaluateHealthAlerts(snapshot(1_000, "DEGRADED"), state, policy);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ severity: "warning" });
    state = result.next;

    result = evaluateHealthAlerts(snapshot(2_000, "DEGRADED"), state, policy);
    expect(result.events).toHaveLength(0);
    state = result.next;

    result = evaluateHealthAlerts(snapshot(3_000, "DOWN"), state, policy);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ severity: "critical", previousStatus: "DEGRADED" });
    state = result.next;

    result = evaluateHealthAlerts(snapshot(4_000, "DOWN"), state, policy);
    expect(result.events).toHaveLength(0);
  });

  it("respects the severity floor without losing the escalation", () => {
    const policy = { minSeverity: "critical", renotifyMs: 0, hysteresis: 1 } as const;
    let state = EMPTY_ALERT_STATE;

    let result = evaluateHealthAlerts(snapshot(1_000, "DEGRADED"), state, policy);
    expect(result.events).toHaveLength(0);
    state = result.next;

    result = evaluateHealthAlerts(snapshot(2_000, "DOWN"), state, policy);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ severity: "critical" });
    state = result.next;

    result = evaluateHealthAlerts(snapshot(3_000, "HEALTHY"), state, policy);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ state: "RESOLVED" });
  });

  it("does not emit a resolution for a condition that was below the floor", () => {
    const policy = { minSeverity: "critical", renotifyMs: 0, hysteresis: 1 } as const;
    let state = EMPTY_ALERT_STATE;

    let result = evaluateHealthAlerts(snapshot(1_000, "DEGRADED"), state, policy);
    state = result.next;
    result = evaluateHealthAlerts(snapshot(2_000, "HEALTHY"), state, policy);
    expect(result.events).toHaveLength(0);
  });

  it("tracks the cycle and each source independently", () => {
    const policy = { minSeverity: "info", renotifyMs: 0, hysteresis: 1 } as const;
    const result = evaluateHealthAlerts(
      snapshot(1_000, "HEALTHY", [
        { key: "odds-api", status: "HEALTHY" },
        { key: "parlay-api", status: "DOWN" },
      ]),
      EMPTY_ALERT_STATE,
      policy
    );
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      id: "source:parlay-api",
      code: "SOURCE_DOWN",
      scope: "source",
      sourceKey: "parlay-api",
      severity: "critical",
    });
  });

  it("resolves a firing condition that disappears from the snapshot", () => {
    const policy = { minSeverity: "info", renotifyMs: 0, hysteresis: 1 } as const;
    const firing = evaluateHealthAlerts(
      snapshot(1_000, "HEALTHY", [{ key: "parlay-api", status: "DOWN" }]),
      EMPTY_ALERT_STATE,
      policy
    );
    expect(firing.events).toHaveLength(1);

    const gone = evaluateHealthAlerts(snapshot(2_000, "HEALTHY"), firing.next, policy);
    expect(gone.events).toHaveLength(1);
    expect(gone.events[0]).toMatchObject({
      id: "source:parlay-api",
      state: "RESOLVED",
      previousStatus: "DOWN",
    });
  });
});
