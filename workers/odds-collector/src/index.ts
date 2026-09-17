/**
 * @22void/odds-collector
 *
 * Scheduled odds polling worker (BUILD_AGENT_PROMPT Phase 14).
 * Responsibilities: provider polling, rate limiting, retries/backoff, raw payload
 * capture, normalization job triggers, detection job triggers, heartbeat.
 *
 * Status: Phase 0 shell. Polling logic is implemented in Phase 14. This file only
 * proves the workspace wiring.
 */

export interface WorkerHeartbeat {
  workerId: string;
  lastRunAt?: string;
  scansInFlight: number;
}

/** Returns the default worker id for this process. */
export function workerId(): string {
  return `odds-collector-${process.pid}`;
}