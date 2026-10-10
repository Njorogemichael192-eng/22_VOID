/**
 * Alert types (Phase 19).
 *
 * The vocabulary is deliberately small. A signal has one of three levels, an
 * alert has a severity derived from that level, and every alert is either
 * FIRING (the condition is present) or RESOLVED (it has cleared). Keeping the
 * levels to `HEALTHY`/`DEGRADED`/`DOWN` — the same words the source registry
 * already uses — means the evaluator never has to learn a provider's private
 * status names: the worker maps its own statuses into these three.
 */

/** A health level for one signal. `HEALTHY` is the only non-incident level. */
export type HealthLevel = "HEALTHY" | "DEGRADED" | "DOWN";

/** Ordered, most severe last; the policy floor compares by rank. */
export type AlertSeverity = "info" | "warning" | "critical";

/** Whether an alert event reports a condition that has started or one that cleared. */
export type AlertState = "FIRING" | "RESOLVED";

/** One observed signal: its level and the instant it was last observed. */
export interface SignalStatus {
  readonly status: HealthLevel;
  readonly at: number;
}

/** A per-source signal. The key is the provider/source identifier. */
export interface SourceSignal extends SignalStatus {
  readonly key: string;
}

/**
 * Everything one evaluation sees. `at` is the evaluation instant; the per-signal
 * `at` is when that signal was last observed, which the event carries as `since`.
 */
export interface HealthSnapshot {
  readonly at: number;
  readonly cycle: SignalStatus;
  readonly sources: readonly SourceSignal[];
}

/**
 * One alert to deliver.
 *
 * `id` is the stable dedup key (a condition, not an event): `cycle` for the
 * worker cycle, `source:<key>` for a source. It is the same for every event
 * about that condition, so a consumer can thread a firing alert to its
 * resolution. `severity` is derived from `status`, `previousStatus` is the level
 * observed immediately before (null on the first observation), `since` is when
 * the condition was first seen and `at` is when this event was emitted.
 */
export interface AlertEvent {
  readonly id: string;
  readonly code: string;
  readonly scope: "cycle" | "source";
  readonly sourceKey?: string;
  readonly severity: AlertSeverity;
  readonly state: AlertState;
  readonly status: HealthLevel;
  readonly previousStatus: HealthLevel | null;
  readonly since: number;
  readonly at: number;
  readonly title: string;
  readonly message: string;
}

/**
 * How the evaluator decides to notify.
 *
 * - `minSeverity`: events below this are tracked but not emitted, so a warning
 *   floor keeps a flapping `DEGRADED` quiet while a `DOWN` still reaches a human.
 * - `renotifyMs`: while a condition is still firing, re-emit at most this often;
 *   `0` disables re-notification entirely (fire once, then only resolve).
 * - `hysteresis`: consecutive unhealthy observations required before firing, so a
 *   single bad cycle between healthy ones is not treated as an incident.
 */
export interface AlertPolicy {
  readonly minSeverity: AlertSeverity;
  readonly renotifyMs: number;
  readonly hysteresis: number;
}

/** Carried state for one condition between evaluations. */
export interface RuleState {
  readonly level: HealthLevel;
  readonly sinceFirstBad: number | null;
  readonly badStreak: number;
  readonly active: boolean;
  readonly notified: boolean;
  readonly notifiedSeverity: AlertSeverity | null;
  readonly notifiedAt: number | null;
}

/** The evaluator's memory: one rule per condition, keyed by alert id. */
export interface AlertEvaluationState {
  readonly rules: Readonly<Record<string, RuleState>>;
}

export interface AlertEvaluation {
  readonly events: readonly AlertEvent[];
  readonly next: AlertEvaluationState;
}

/** A destination for alert events. `name` is for diagnostics only. */
export interface AlertSink {
  readonly name: string;
  send(event: AlertEvent): Promise<void>;
}

export interface WebhookAlertSinkOptions {
  readonly url: string;
  /** Abort a slow endpoint so a stuck sink cannot pile requests up. */
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export interface AlertNotifierOptions {
  readonly sink: AlertSink;
  readonly policy?: AlertPolicy;
  /**
   * Called when a sink rejects. Defaults to `console.error`. It is invoked and
   * swallowed: delivery is best-effort and must never throw into the caller.
   */
  readonly onError?: (error: unknown, event: AlertEvent) => void;
}

/** Stateful evaluator + sink. `observe` never rejects. */
export interface AlertNotifier {
  observe(snapshot: HealthSnapshot): Promise<readonly AlertEvent[]>;
}
