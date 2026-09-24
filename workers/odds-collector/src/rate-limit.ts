/**
 * Provider polling rate limiting (Phase 14).
 *
 * A token-bucket limiter so the worker never exceeds a provider's quota (the
 * Odds API, for example, advertises a requests/minute ceiling). The clock and
 * the sleep function are injectable so tests can advance time deterministically
 * without real waits.
 */

export interface RateLimitOptions {
  /** Burst capacity — the maximum tokens the bucket can hold. */
  readonly capacity: number;
  /** Refill rate in tokens per second. */
  readonly refillPerSecond: number;
  /** Clock override (default `Date.now`). */
  readonly now?: () => number;
  /** Wait primitive override (default `setTimeout` promise). */
  readonly delay?: (ms: number) => Promise<void>;
}

export interface RateLimiter {
  readonly capacity: number;
  /** Milliseconds until the next token is available (0 when one exists). */
  queuedMs(): number;
  /** Consumes one token, waiting for a refill when the bucket is empty. */
  acquire(): Promise<void>;
}

const timeout = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Token-bucket rate limiter. */
export class TokenBucketRateLimiter implements RateLimiter {
  readonly capacity: number;
  private tokens: number;
  private lastRefillMs: number;
  private readonly refillPerMs: number;
  private readonly now: () => number;
  private readonly delay: (ms: number) => Promise<void>;

  constructor(options: RateLimitOptions) {
    if (options.capacity <= 0) throw new Error("capacity must be positive");
    if (options.refillPerSecond <= 0) throw new Error("refillPerSecond must be positive");
    this.capacity = options.capacity;
    this.refillPerMs = options.refillPerSecond / 1000;
    this.now = options.now ?? (() => Date.now());
    this.delay = options.delay ?? timeout;
    this.tokens = options.capacity;
    this.lastRefillMs = this.now();
  }

  private refill(): void {
    const at = this.now();
    const elapsedMs = at - this.lastRefillMs;
    if (elapsedMs <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedMs * this.refillPerMs);
    this.lastRefillMs = at;
  }

  queuedMs(): number {
    this.refill();
    if (this.tokens >= 1) return 0;
    return Math.ceil((1 - this.tokens) / this.refillPerMs);
  }

  async acquire(): Promise<void> {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await this.delay(Math.max(1, Math.ceil(this.queuedMs())));
    }
  }
}