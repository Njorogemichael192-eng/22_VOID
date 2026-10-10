/**
 * Pure alert evaluation (Phase 19).
 *
 * `evaluateHealthAlerts` is a fold: given the current signals and the state from
 * the previous run, it returns the events to deliver and the state to carry
 * forward. It has no clock, no I/O and no config beyond the policy, so every
 * rule below is a unit test rather than an integration.
 *
 * The semantics that matter:
 *
 * - **Transition, not level.** A condition notifies when it *becomes* unhealthy,
 *   not on every evaluation while it stays unhealthy. A worker that is `DOWN`
 *   for an hour produces one firing alert, not one per cycle.
 * - **Resolve on recovery.** Clearing a condition emits a `RESOLVED` event so the
 *   same thread that opened the incident closes it.
 * - **Hysteresis.** `policy.hysteresis` consecutive unhealthy observations are
 *   required before firing, so a single bad cycle between healthy ones is not an
 *   incident. The streak resets the moment a healthy observation arrives.
 * - **Escalation.** If a firing condition worsens (`DEGRADED` → `DOWN`) it
 *   notifies immediately, bypassing the re-notify cooldown, because a worsening
 *   incident is new information rather than a repeat.
 * - **Floor.** Events below `policy.minSeverity` are tracked but not emitted, so a
 *   warning floor keeps `DEGRADED` churn quiet while still escalating a `DOWN`.
 * - **Disappearance.** A condition that was firing but is absent from the
 *   snapshot (a source removed from the config) resolves rather than staying
 *   open forever.
 */

import {
  type AlertEvaluation,
  type AlertEvaluationState,
  type AlertEvent,
  type AlertPolicy,
  type AlertSeverity,
  type HealthLevel,
  type HealthSnapshot,
  type RuleState,
} from "./types.js";

export const EMPTY_ALERT_STATE: AlertEvaluationState = { rules: {} };

export const DEFAULT_ALERT_POLICY: AlertPolicy = {
  minSeverity: "warning",
  renotifyMs: 30 * 60 * 1000,
  hysteresis: 1,
};

const SEVERITY_RANK: Readonly<Record<AlertSeverity, number>> = {
  info: 0,
  warning: 1,
  critical: 2,
};

function severityForLevel(level: HealthLevel): AlertSeverity {
  return level === "DOWN" ? "critical" : "warning";
}

interface Observation {
  readonly id: string;
  readonly scope: "cycle" | "source";
  readonly sourceKey?: string;
  readonly level: HealthLevel;
  readonly at: number;
}

function label(observation: Observation): string {
  return observation.scope === "cycle"
    ? "Worker cycle"
    : `Source ${observation.sourceKey ?? "unknown"}`;
}

function codeFor(observation: Observation, level: HealthLevel): string {
  const prefix = observation.scope === "cycle" ? "WORKER" : "SOURCE";
  return `${prefix}_${level}`;
}

function firingEvent(
  observation: Observation,
  now: number,
  since: number,
  previousStatus: HealthLevel | null
): AlertEvent {
  const severity = severityForLevel(observation.level);
  const who = label(observation);
  return {
    id: observation.id,
    code: codeFor(observation, observation.level),
    scope: observation.scope,
    ...(observation.sourceKey === undefined ? {} : { sourceKey: observation.sourceKey }),
    severity,
    state: "FIRING",
    status: observation.level,
    previousStatus,
    since,
    at: now,
    title: `${who} ${observation.level}`,
    message: `${who} is ${observation.level} (since ${new Date(since).toISOString()}).`,
  };
}

function resolvedEvent(prior: RuleState, observation: Observation, now: number): AlertEvent {
  const who = label(observation);
  return {
    id: observation.id,
    code: codeFor(observation, prior.level),
    scope: observation.scope,
    ...(observation.sourceKey === undefined ? {} : { sourceKey: observation.sourceKey }),
    severity: severityForLevel(prior.level),
    state: "RESOLVED",
    status: "HEALTHY",
    previousStatus: prior.level,
    since: prior.sinceFirstBad ?? now,
    at: now,
    title: `${who} recovered`,
    message: `${who} recovered (was ${prior.level}).`,
  };
}

/**
 * Advance one condition's state by one observation, appending any events.
 *
 * Split out so the whole rule set reads top to bottom: update the streak, decide
 * whether the condition should be firing, then decide whether that warrants a
 * new event (transition, escalation, or re-notify).
 */
function advanceRule(
  observation: Observation,
  prior: RuleState | undefined,
  policy: AlertPolicy,
  now: number,
  events: AlertEvent[]
): RuleState {
  const level = observation.level;
  const bad = level !== "HEALTHY";
  const badStreak = bad ? (prior?.badStreak ?? 0) + 1 : 0;
  const sinceFirstBad = bad ? (prior?.sinceFirstBad ?? observation.at) : null;
  const shouldFire = bad && badStreak >= Math.max(1, policy.hysteresis);

  if (!shouldFire) {
    if (prior?.active === true && prior.notified) {
      events.push(resolvedEvent(prior, observation, now));
    }
    // A bad observation below the hysteresis threshold keeps its streak (that is
    // how the threshold is reached); only a healthy one resets to zero, and the
    // `bad` guard above already did that for the streak and `sinceFirstBad`.
    return {
      level,
      sinceFirstBad,
      badStreak,
      active: false,
      notified: false,
      notifiedSeverity: null,
      notifiedAt: null,
    };
  }

  const active = prior?.active === true;
  const previousStatus = prior?.level ?? null;
  const severity = severityForLevel(level);

  if (!active) {
    // Rising edge: the condition has just become unhealthy.
    if (SEVERITY_RANK[severity] >= SEVERITY_RANK[policy.minSeverity]) {
      events.push(
        firingEvent(observation, now, sinceFirstBad ?? observation.at, previousStatus)
      );
      return {
        level,
        sinceFirstBad,
        badStreak,
        active: true,
        notified: true,
        notifiedSeverity: severity,
        notifiedAt: now,
      };
    }
    return {
      level,
      sinceFirstBad,
      badStreak,
      active: true,
      notified: false,
      notifiedSeverity: null,
      notifiedAt: null,
    };
  }

  const notifiedAt = prior?.notifiedAt ?? null;
  const notifiedSeverity = prior?.notifiedSeverity ?? null;
  const escalated =
    prior?.notified === true &&
    notifiedSeverity !== null &&
    SEVERITY_RANK[severity] > SEVERITY_RANK[notifiedSeverity];
  const due =
    prior?.notified !== true ||
    (policy.renotifyMs > 0 && notifiedAt !== null && now - notifiedAt >= policy.renotifyMs);

  if (SEVERITY_RANK[severity] >= SEVERITY_RANK[policy.minSeverity] && (escalated || due)) {
    events.push(firingEvent(observation, now, sinceFirstBad ?? observation.at, previousStatus));
    return {
      level,
      sinceFirstBad,
      badStreak,
      active: true,
      notified: true,
      notifiedSeverity: severity,
      notifiedAt: now,
    };
  }

  return {
    level,
    sinceFirstBad,
    badStreak,
    active: true,
    notified: prior?.notified ?? false,
    notifiedSeverity,
    notifiedAt,
  };
}

export function evaluateHealthAlerts(
  snapshot: HealthSnapshot,
  previous: AlertEvaluationState = EMPTY_ALERT_STATE,
  policy: AlertPolicy = DEFAULT_ALERT_POLICY
): AlertEvaluation {
  const events: AlertEvent[] = [];
  const rules: Record<string, RuleState> = {};

  const observations: Observation[] = [
    { id: "cycle", scope: "cycle", level: snapshot.cycle.status, at: snapshot.cycle.at },
    ...snapshot.sources.map(
      (source): Observation => ({
        id: `source:${source.key}`,
        scope: "source",
        sourceKey: source.key,
        level: source.status,
        at: source.at,
      })
    ),
  ];

  const seen = new Set<string>();
  for (const observation of observations) {
    seen.add(observation.id);
    const prior = previous.rules[observation.id];
    rules[observation.id] = advanceRule(observation, prior, policy, snapshot.at, events);
  }

  // A condition that was firing but is no longer reported resolves. This is the
  // case of a source dropped from WORKER_PROVIDER while it was down: keeping the
  // rule firing forever would leave an incident nobody can clear.
  for (const [id, prior] of Object.entries(previous.rules)) {
    if (seen.has(id) || !prior.notified) continue;
    const observation: Observation = {
      id,
      scope: id === "cycle" ? "cycle" : "source",
      ...(id.startsWith("source:") ? { sourceKey: id.slice("source:".length) } : {}),
      level: "HEALTHY",
      at: snapshot.at,
    };
    events.push(resolvedEvent(prior, observation, snapshot.at));
  }

  return { events, next: { rules } };
}
