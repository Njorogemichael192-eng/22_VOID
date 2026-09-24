/**
 * Polling retries with exponential backoff (Phase 14).
 *
 * Delivery criterion for the worker: **transient provider failures recover**.
 * A transient failure is a ~429 or 5xx HTTP status, a network-level transport
 * error, or an abort/timeout — anything a retry has a real chance of fixing.
 * Permanent failures (4xx other than 429, schema violations) are re-raised
 * immediately so the worker records the source as DOWN rather than guessing
 * inside an endless loop.
 *
 * The delay grows exponentially (`baseDelay * 2^(attempt-1)`) capped at
 * `maxDelayMs`, with ±50% jitter to avoid thundering-herd retries.
 */

import { ProviderTransportError } from "@22void/provider-contracts";

export interface RetryPolicy {
  /** Total polling attempts including the first (>= 1). */
  readonly maxAttempts: number;
  /** First retry delay in ms. */
  readonly baseDelayMs: number;
  /** Ceiling for any single backoff delay in ms. */
  readonly maxDelayMs: number;
  /** Adds ±50% random jitter to every delay. */
  readonly jitter: boolean;
  /** Returns true when the error is worth a retry. */
  readonly retryable: (error: unknown) => boolean;
  /** Called before each wait (for observability). */
  readonly onRetry?: (info: { attempt: number; error: unknown; delayMs: number }) => void;
  /** Wait primitive override (default `setTimeout` promise). */
  readonly sleep?: (ms: number) => Promise<void>;
}

/** Network-level error codes that are worth retrying. */
const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "SOCKET_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
]);

function transientCode(error: unknown): boolean {
  if (error === null || error === undefined || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && TRANSIENT_CODES.has(code);
}

/**
 * Classifies a provider error as transient. `ProviderTransportError` with no
 * HTTP status is a network-level failure; with a status it is transient only
 * for 429 and >= 500. Everything else uses its error code/name.
 */
export function isRetryableTransient(error: unknown): boolean {
  if (error instanceof ProviderTransportError) {
    if (error.status === undefined) return true;
    return error.status === 429 || error.status >= 500;
  }
  if (error instanceof Error) {
    if (error.name === "AbortError" || error.name === "TimeoutError") return true;
    return transientCode(error);
  }
  return false;
}

/** Default retry policy: 4 attempts, 250ms->~2s, jittered. */
export function defaultRetryPolicy(overrides: Partial<RetryPolicy> = {}): RetryPolicy {
  return {
    maxAttempts: 4,
    baseDelayMs: 250,
    maxDelayMs: 2_000,
    jitter: true,
    retryable: isRetryableTransient,
    ...overrides,
  };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Backoff delay for retry `attempt` (1-based). Without jitter the sequence is
 * `baseDelay, baseDelay*2, baseDelay*4, ...` capped at `maxDelayMs`.
 */
export function retryDelayMs(attempt: number, policy: Pick<RetryPolicy, "baseDelayMs" | "maxDelayMs" | "jitter">): number {
  const raw = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  if (!policy.jitter) return raw;
  const jitterFactor = 0.5 + Math.random();
  return Math.min(policy.maxDelayMs, Math.round(raw * jitterFactor));
}

/**
 * Runs `fn`, retrying transient failures with backoff. Retries stop when
 * `maxAttempts` is exhausted or the error is not retryable.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy
): Promise<T> {
  let attempt = 1;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= policy.maxAttempts || !policy.retryable(error)) throw error;
      const delayMs = retryDelayMs(attempt, policy);
      policy.onRetry?.({ attempt, error, delayMs });
      await (policy.sleep ?? sleep)(delayMs);
      attempt += 1;
    }
  }
}