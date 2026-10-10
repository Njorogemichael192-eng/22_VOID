import { describe, expect, it, vi } from "vitest";

import { EMPTY_ALERT_STATE, evaluateHealthAlerts } from "./evaluate.js";
import {
  AlertDeliveryError,
  createAlertNotifier,
  createLogAlertSink,
  createNoopAlertSink,
  createWebhookAlertSink,
} from "./sinks.js";
import type { AlertEvent, AlertSink, HealthLevel } from "./types.js";

function cycleEvent(level: HealthLevel): AlertEvent {
  const { events } = evaluateHealthAlerts(
    { at: 1_000, cycle: { status: level, at: 1_000 }, sources: [] },
    EMPTY_ALERT_STATE,
    { minSeverity: "info", renotifyMs: 0, hysteresis: 1 }
  );
  return events[0]!;
}

describe("alert sinks", () => {
  it("noop sink accepts and drops events", async () => {
    await expect(createNoopAlertSink().send(cycleEvent("DOWN"))).resolves.toBeUndefined();
  });

  it("log sink writes one line per event", async () => {
    const lines: string[] = [];
    const sink = createLogAlertSink((line) => lines.push(line));
    await sink.send(cycleEvent("DOWN"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("FIRING");
    expect(lines[0]).toContain("WORKER_DOWN");
    expect(lines[0]).toContain("severity=critical");
  });

  it("webhook sink POSTs the event as JSON", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => ({ ok: true, status: 202 }) as Response);
    const sink = createWebhookAlertSink({ url: "https://hooks.example/alert", fetchImpl });
    await sink.send(cycleEvent("DOWN"));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://hooks.example/alert");
    expect(init).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(init?.body))).toMatchObject({ id: "cycle", state: "FIRING" });
  });

  it("webhook sink raises AlertDeliveryError on a non-2xx response", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500 }) as Response);
    const sink = createWebhookAlertSink({ url: "https://hooks.example/alert", fetchImpl });
    await expect(sink.send(cycleEvent("DOWN"))).rejects.toBeInstanceOf(AlertDeliveryError);
  });

  it("webhook sink wraps a transport failure in AlertDeliveryError", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("connection refused");
    });
    const sink = createWebhookAlertSink({ url: "https://hooks.example/alert", fetchImpl });
    await expect(sink.send(cycleEvent("DOWN"))).rejects.toBeInstanceOf(AlertDeliveryError);
  });
});

describe("createAlertNotifier", () => {
  it("delivers only transitions and carries state between observations", async () => {
    const sent: AlertEvent[] = [];
    const sink: AlertSink = {
      name: "test",
      send: (event) => {
        sent.push(event);
        return Promise.resolve();
      },
    };
    const notifier = createAlertNotifier({
      sink,
      policy: { minSeverity: "info", renotifyMs: 0, hysteresis: 1 },
    });

    await notifier.observe({ at: 1_000, cycle: { status: "HEALTHY", at: 1_000 }, sources: [] });
    await notifier.observe({ at: 2_000, cycle: { status: "DOWN", at: 2_000 }, sources: [] });
    await notifier.observe({ at: 3_000, cycle: { status: "DOWN", at: 3_000 }, sources: [] });
    await notifier.observe({ at: 4_000, cycle: { status: "HEALTHY", at: 4_000 }, sources: [] });

    expect(sent.map((event) => event.state)).toEqual(["FIRING", "RESOLVED"]);
  });

  it("swallows a sink rejection and reports it through onError", async () => {
    const errors: unknown[] = [];
    const sink: AlertSink = {
      name: "broken",
      send: () => Promise.reject(new Error("webhook down")),
    };
    const notifier = createAlertNotifier({
      sink,
      onError: (error) => errors.push(error),
      policy: { minSeverity: "info", renotifyMs: 0, hysteresis: 1 },
    });

    const events = await notifier.observe({
      at: 2_000,
      cycle: { status: "DOWN", at: 2_000 },
      sources: [],
    });

    expect(events).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });
});
