import type { IncomingMessage, ServerResponse } from "node:http";

import { describe, expect, it } from "vitest";

import {
  createHealthRequestHandler,
  createWorkerHealthState,
  evaluateWorkerHealth,
} from "./health.js";

const STARTED_AT = Date.parse("2026-09-25T00:00:00.000Z");

describe("worker health state", () => {
  it("keeps the process start timestamp fixed and allows startup grace", () => {
    let now = STARTED_AT;
    const state = createWorkerHealthState({
      startedAt: STARTED_AT,
      startupGraceMs: 1_000,
      staleAfterMs: 5_000,
      now: () => now,
      service: "test-service",
      workerId: "test-worker",
      pid: 42,
    });

    const duringGrace = state.snapshot(0, STARTED_AT + 999);
    now = STARTED_AT + 1_000;
    const afterGrace = state.snapshot(0, now);

    expect(duringGrace).toMatchObject({
      ready: true,
      status: "starting",
      reason: "startup_grace",
      service: "test-service",
      workerId: "test-worker",
      startedAt: "2026-09-25T00:00:00.000Z",
      lastCycleAt: null,
      lastCycleStatus: null,
      runCount: 0,
      pid: 42,
    });
    expect(afterGrace.ready).toBe(false);
    expect(afterGrace.reason).toBe("no_cycle_after_grace");
    expect(afterGrace.startedAt).toBe(duringGrace.startedAt);
  });

  it("becomes ready after a successful cycle", () => {
    const cycleAt = STARTED_AT + 2_000;
    const state = createWorkerHealthState({
      startedAt: STARTED_AT,
      startupGraceMs: 1_000,
      staleAfterMs: 5_000,
    });
    state.recordCycle("OK", cycleAt);

    expect(state.snapshot(1, cycleAt + 100)).toMatchObject({
      ready: true,
      status: "ok",
      lastCycleAt: "2026-09-25T00:00:02.000Z",
      lastCycleStatus: "OK",
      runCount: 1,
      ageMs: 100,
    });
  });

  it("is not ready for degraded, down, or error cycles", () => {
    for (const status of ["DEGRADED", "DOWN", "ERROR"]) {
      const state = createWorkerHealthState({
        startedAt: STARTED_AT,
        startupGraceMs: 0,
        staleAfterMs: 5_000,
      });
      state.recordCycle(status, STARTED_AT + 10);

      const snapshot = state.snapshot(1, STARTED_AT + 10);
      expect(snapshot.ready).toBe(false);
      expect(snapshot.lastCycleStatus).toBe(status);
    }
  });

  it("is not ready when the last successful cycle is stale", () => {
    const state = createWorkerHealthState({
      startedAt: STARTED_AT,
      startupGraceMs: 0,
      staleAfterMs: 5_000,
    });
    state.recordCycle("OK", STARTED_AT + 10);

    const snapshot = state.snapshot(1, STARTED_AT + 5_010);
    expect(snapshot.ready).toBe(false);
    expect(snapshot.status).toBe("stale");
    expect(snapshot.reason).toBe("last_cycle_stale");
    expect(snapshot.ageMs).toBe(5_000);
  });

  it("returns non-sensitive fields needed by health consumers", () => {
    const state = createWorkerHealthState({
      startedAt: STARTED_AT,
      startupGraceMs: 0,
      staleAfterMs: 5_000,
    });
    state.recordCycle("OK", STARTED_AT);

    const snapshot = state.snapshot(4, STARTED_AT);
    expect(Object.keys(snapshot)).toEqual(
      expect.arrayContaining([
        "status",
        "service",
        "workerId",
        "startedAt",
        "lastCycleAt",
        "lastCycleStatus",
        "runCount",
        "pid",
      ])
    );
    expect(snapshot).not.toHaveProperty("error");
  });
});

function invokeHealthRequest(
  handler: ReturnType<typeof createHealthRequestHandler>,
  path: string
): { statusCode: number; body: Record<string, unknown> } {
  let statusCode: number | undefined;
  let body = "";
  const request = { method: "GET", url: path } as IncomingMessage;
  const response = {
    writeHead(code: number): void {
      statusCode = code;
    },
    end(value?: string): void {
      body = value ?? "";
    },
  } as unknown as ServerResponse;
  handler(request, response);
  if (statusCode === undefined) throw new Error("health handler did not write a response");
  return { statusCode, body: JSON.parse(body) as Record<string, unknown> };
}

describe("health request routing", () => {
  it("keeps liveness at 200 and aliases health to readiness", () => {
    const state = createWorkerHealthState({
      startedAt: STARTED_AT,
      startupGraceMs: 0,
      staleAfterMs: 5_000,
      now: () => STARTED_AT,
    });
    const handler = createHealthRequestHandler({ state, getRunCount: () => 0 });

    const live = invokeHealthRequest(handler, "/livez");
    const ready = invokeHealthRequest(handler, "/readyz");
    const health = invokeHealthRequest(handler, "/healthz");

    expect(live.statusCode).toBe(200);
    expect(live.body).toMatchObject({ status: "ok", ready: false });
    expect(ready.statusCode).toBe(503);
    expect(health.statusCode).toBe(503);
    expect(health.body).toEqual(ready.body);

    state.recordCycle("OK", STARTED_AT);
    const readyAfterCycle = invokeHealthRequest(handler, "/readyz");
    const healthAfterCycle = invokeHealthRequest(handler, "/healthz");
    expect(readyAfterCycle.statusCode).toBe(200);
    expect(healthAfterCycle).toEqual(readyAfterCycle);
  });
});

describe("evaluateWorkerHealth", () => {
  it("fails closed for an unknown last-cycle status", () => {
    expect(
      evaluateWorkerHealth({
        startedAt: STARTED_AT,
        now: STARTED_AT + 1,
        lastCycleAt: STARTED_AT,
        lastCycleStatus: "UNKNOWN",
        startupGraceMs: 0,
        staleAfterMs: 5_000,
      })
    ).toMatchObject({ ready: false, reason: "last_cycle_status_unknown" });
  });
});
