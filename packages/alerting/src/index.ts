/**
 * @22void/alerting — health alert evaluation and delivery (Phase 19).
 *
 * The scan worker already produces health signals: a per-cycle status and a
 * per-source availability (`HEALTHY`/`DEGRADED`/`DOWN`). Until now nothing
 * consumed them — an operator had to wire their own monitor to `/healthz` and
 * `/api/v1/scanner` and decide by hand what counted as an incident.
 *
 * This package is the missing consumer, split so the decision is pure and the
 * delivery is a port:
 *
 * - `evaluateHealthAlerts` turns a snapshot of the current signals plus the
 *   state carried from the previous evaluation into a list of alert events.
 *   It only fires on a **transition** into an unhealthy level and only resolves
 *   on recovery, so a condition that persists does not re-notify every cycle.
 * - `AlertSink` is where an event goes (a webhook, the log, or nowhere). A
 *   delivery failure is the sink's to report and the notifier's to swallow: a
 *   broken webhook must never fail a scan cycle.
 */

export { DEFAULT_ALERT_POLICY, EMPTY_ALERT_STATE, evaluateHealthAlerts } from "./evaluate.js";
export {
  AlertDeliveryError,
  createAlertNotifier,
  createLogAlertSink,
  createNoopAlertSink,
  createWebhookAlertSink,
} from "./sinks.js";
export type {
  AlertEvaluation,
  AlertEvaluationState,
  AlertEvent,
  AlertNotifier,
  AlertNotifierOptions,
  AlertPolicy,
  AlertSeverity,
  AlertSink,
  AlertState,
  HealthLevel,
  HealthSnapshot,
  RuleState,
  SignalStatus,
  SourceSignal,
  WebhookAlertSinkOptions,
} from "./types.js";
