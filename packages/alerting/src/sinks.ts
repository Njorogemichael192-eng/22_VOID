/**
 * Alert delivery (Phase 19).
 *
 * `createAlertNotifier` pairs the pure evaluator with a sink. It owns the
 * carried state (in memory, by design: a worker restart may re-fire one alert per
 * still-broken signal, which is cheaper and simpler than a table for this) and it
 * never rejects — a delivery failure is reported through `onError` and swallowed,
 * because a scan cycle must not fail because a webhook is down.
 *
 * `createWebhookAlertSink` is the integration point: a single JSON POST of the
 * `AlertEvent`. It deliberately sends the event verbatim and logs nothing about
 * the URL, which may carry a token in its path (a Slack-style incoming hook).
 */

import { evaluateHealthAlerts, EMPTY_ALERT_STATE } from "./evaluate.js";
import type {
  AlertEvent,
  AlertNotifier,
  AlertNotifierOptions,
  AlertSink,
  WebhookAlertSinkOptions,
} from "./types.js";

/** Raised by a sink when delivery fails, so callers can distinguish it from a bug. */
export class AlertDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlertDeliveryError";
  }
}

/** A sink for when alerting is configured off; drops every event. */
export function createNoopAlertSink(): AlertSink {
  return {
    name: "noop",
    send(): Promise<void> {
      return Promise.resolve();
    },
  };
}

/**
 * A sink that writes one line per event to the log.
 *
 * Useful on its own for a single-node deployment and as the default in tests;
 * the line carries the code, severity and state so a log-based alert rule can
 * match on it without parsing the full JSON.
 */
export function createLogAlertSink(
  write: (line: string) => void = (line) => console.log(line)
): AlertSink {
  return {
    name: "log",
    send(event: AlertEvent): Promise<void> {
      write(
        `[alerting] ${event.state} ${event.code} severity=${event.severity} since=${new Date(
          event.since
        ).toISOString()} ${event.message}`
      );
      return Promise.resolve();
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createWebhookAlertSink(options: WebhookAlertSinkOptions): AlertSink {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;

  return {
    name: "webhook",
    async send(event: AlertEvent): Promise<void> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(options.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(event),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new AlertDeliveryError(`webhook responded ${response.status}`);
        }
      } catch (error) {
        if (error instanceof AlertDeliveryError) throw error;
        throw new AlertDeliveryError(`webhook delivery failed: ${errorMessage(error)}`);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export function createAlertNotifier(options: AlertNotifierOptions): AlertNotifier {
  const onError =
    options.onError ??
    ((error: unknown, event: AlertEvent) => console.error(`[alerting] ${event.id}:`, error));
  let state = EMPTY_ALERT_STATE;

  return {
    async observe(snapshot) {
      const { events, next } = evaluateHealthAlerts(snapshot, state, options.policy);
      state = next;
      for (const event of events) {
        try {
          await options.sink.send(event);
        } catch (error) {
          onError(error, event);
        }
      }
      return events;
    },
  };
}
