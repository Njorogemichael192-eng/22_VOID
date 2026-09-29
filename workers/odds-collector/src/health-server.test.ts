/**
 * Exercises the health server over a real socket.
 *
 * `health.test.ts` drives the handler with a fake request/response pair, which
 * cannot see the things that decide whether the container healthcheck is
 * trustworthy: the timeouts on the listening server, and the headers that stop
 * an intermediary from replaying a stale 200.
 */

import { afterEach, describe, expect, it } from "vitest";

import { createHealthServer, createWorkerHealthState } from "./health.js";

const STARTED_AT = Date.parse("2026-09-26T00:00:00.000Z");

const openServers: { close: (cb: () => void) => void }[] = [];

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

interface Harness {
  readonly url: string;
  readonly state: ReturnType<typeof createWorkerHealthState>;
  readonly server: ReturnType<typeof createHealthServer>;
}

async function startHealthServer(
  options: { now: number; lastCycle?: { status: string; at: number } } ,
): Promise<Harness> {
  const nowRef = { value: options.now };
  const state = createWorkerHealthState({
    startedAt: STARTED_AT,
    startupGraceMs: 30_000,
    staleAfterMs: 300_000,
    now: () => nowRef.value,
    service: "test-service",
    workerId: "test-worker",
    pid: 42,
  });
  if (options.lastCycle !== undefined) {
    state.recordCycle(options.lastCycle.status, options.lastCycle.at);
  }

  const server = createHealthServer({ state, getRunCount: () => 0 });
  openServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a TCP address");
  }
  return { url: `http://127.0.0.1:${address.port}`, state, server };
}

describe("health server over HTTP", () => {
  it("answers /livez with 200 while the worker is still starting", async () => {
    const { url } = await startHealthServer({ now: STARTED_AT + 1_000 });
    const response = await fetch(`${url}/livez`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "ok" });
  });

  it("reports ready during startup grace, but not as status ok", async () => {
    // A worker that has not cycled yet is still ready — refusing traffic during
    // grace would just delay the first scrape. It is not "ok" though, which is
    // why the compose healthcheck needs a start_period longer than a cold boot.
    const { url } = await startHealthServer({ now: STARTED_AT + 1_000 });
    const response = await fetch(`${url}/readyz`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "starting",
      ready: true,
      reason: "startup_grace",
    });
  });

  it("answers /readyz with 503 once the grace period passes with no cycle", async () => {
    const { url } = await startHealthServer({ now: STARTED_AT + 31_000 });
    const response = await fetch(`${url}/readyz`);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "starting",
      ready: false,
      reason: "no_cycle_after_grace",
    });
  });

  it("answers /healthz with 503 when the last cycle is degraded", async () => {
    const { url } = await startHealthServer({
      now: STARTED_AT + 60_000,
      lastCycle: { status: "DEGRADED", at: STARTED_AT + 59_000 },
    });
    const response = await fetch(`${url}/healthz`);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ status: "degraded" });
  });

  it("answers /healthz with 503 once the last cycle goes stale", async () => {
    const { url } = await startHealthServer({
      now: STARTED_AT + 400_000,
      lastCycle: { status: "OK", at: STARTED_AT + 1_000 },
    });
    const response = await fetch(`${url}/healthz`);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ status: "stale" });
  });

  it("answers /healthz with 200 and status ok on a healthy cycle", async () => {
    const { url } = await startHealthServer({
      now: STARTED_AT + 60_000,
      lastCycle: { status: "OK", at: STARTED_AT + 59_000 },
    });
    const response = await fetch(`${url}/healthz`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "ok", ready: true });
  });

  it("never lets a proxy cache the verdict", async () => {
    const { url } = await startHealthServer({
      now: STARTED_AT + 60_000,
      lastCycle: { status: "OK", at: STARTED_AT + 59_000 },
    });
    for (const path of ["/livez", "/readyz", "/healthz"]) {
      const response = await fetch(`${url}${path}`);
      expect(response.headers.get("cache-control"), path).toBe("no-store, max-age=0");
    }
  });

  it("ignores a query string when routing", async () => {
    const { url } = await startHealthServer({ now: STARTED_AT + 1_000 });
    const response = await fetch(`${url}/livez?probe=docker`);
    expect(response.status).toBe(200);
  });

  it("rejects an unknown path and a non-GET method", async () => {
    const { url } = await startHealthServer({ now: STARTED_AT + 1_000 });
    expect((await fetch(`${url}/metrics`)).status).toBe(404);
    expect((await fetch(`${url}/healthz`, { method: "POST" })).status).toBe(404);
  });

  it("bounds how long a stalled client can hold a connection", async () => {
    const { server } = await startHealthServer({ now: STARTED_AT + 1_000 });
    // Node's own defaults are 60s for headers and 300s for a whole request,
    // which on a 15s healthcheck cadence means a single stalled scraper can
    // outlive many generations of checks.
    expect(server.headersTimeout).toBe(5_000);
    expect(server.requestTimeout).toBe(10_000);
    expect(server.keepAliveTimeout).toBe(5_000);
  });

  it("honours overridden timeouts", async () => {
    const state = createWorkerHealthState({
      startedAt: STARTED_AT,
      startupGraceMs: 1_000,
      staleAfterMs: 5_000,
      now: () => STARTED_AT,
    });
    const server = createHealthServer({
      state,
      getRunCount: () => 0,
      headersTimeoutMs: 1_000,
      requestTimeoutMs: 2_000,
      keepAliveTimeoutMs: 500,
    });
    openServers.push(server);
    expect(server.headersTimeout).toBe(1_000);
    expect(server.requestTimeout).toBe(2_000);
    expect(server.keepAliveTimeout).toBe(500);
  });
});
