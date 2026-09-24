/**
 * Apps/web API rate limiting (Phase 16).
 *
 * A per-caller token bucket. Unlike the worker's provider limiter (which blocks
 * until a token is available), this one is non-blocking for the HTTP layer: the
 * guard either lets a request through or answers 429 with Retry-After.
 *
 * The store is in-memory, shared per process. That is correct for the current
 * single-instance deployment; a Redis/Upstash-backed limiter is a Phase 20
 * scale item (see docs/ARCHITECTURE.md).
 */

export interface ApiRateLimitConfig {
  /** Burst capacity — max tokens a single caller can hold. */
  readonly capacity: number;
  /** Sustained refill rate in tokens per second. */
  readonly refillPerSecond: number;
  /** Clock override for deterministic tests. */
  readonly now?: () => number;
  /** Prune buckets untouched for this many ms (default 10 minutes). */
  readonly pruneAfterMs?: number;
}

export interface RateLimitResult {
  readonly allowed: boolean;
  /** Tokens remaining after a successful consume (0 when blocked). */
  readonly remaining: number;
  /** Seconds until the next token is available (0 on success). */
  readonly retryAfterMs: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const DEFAULT_PRUNE_AFTER_MS = 10 * 60 * 1000;
const PRUNE_EVERY = 256; // amortize pruning: sweep after this many consults

export class ApiRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly refillPerMs: number;
  private readonly now: () => number;
  private readonly pruneAfterMs: number;
  private consultCount = 0;

  constructor(private readonly config: ApiRateLimitConfig) {
    if (config.capacity <= 0) throw new Error("capacity must be positive");
    if (config.refillPerSecond <= 0) throw new Error("refillPerSecond must be positive");
    this.refillPerMs = config.refillPerSecond / 1000;
    this.now = config.now ?? (() => Date.now());
    this.pruneAfterMs = config.pruneAfterMs ?? DEFAULT_PRUNE_AFTER_MS;
  }

  /** One atomic consult-and-consume for `key` (cost 1 token). */
  consume(key: string): RateLimitResult {
    const at = this.now();
    const existing = this.buckets.get(key);
    let tokens = existing ? existing.tokens : this.config.capacity;
    if (existing) {
      const elapsedMs = at - existing.updatedAt;
      if (elapsedMs > 0) {
        tokens = Math.min(this.config.capacity, tokens + elapsedMs * this.refillPerMs);
      }
    }
    if (tokens >= 1) {
      const remaining = tokens - 1;
      this.buckets.set(key, { tokens: remaining, updatedAt: at });
      this.maybePrune(at);
      return { allowed: true, remaining, retryAfterMs: 0 };
    }
    this.buckets.set(key, { tokens, updatedAt: at });
    this.maybePrune(at);
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.ceil((1 - tokens) / this.refillPerMs),
    };
  }

  /** Test helper: forget all callers. */
  reset(): void {
    this.buckets.clear();
  }

  /** Test helper: number of tracked callers. */
  size(): number {
    return this.buckets.size;
  }

  private maybePrune(at: number): void {
    this.consultCount += 1;
    if (this.consultCount % PRUNE_EVERY !== 0) return;
    for (const [key, bucket] of this.buckets) {
      if (at - bucket.updatedAt > this.pruneAfterMs) this.buckets.delete(key);
    }
  }
}

/**
 * Resolve the caller's IP from the request. `x-forwarded-for` may contain a
 * comma-separated chain (client, proxy1, …); the first hop is the caller. Falls
 * back to `x-real-ip`, then a stable "unknown" bucket so every request is still
 * accounted for.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded && forwarded.trim().length > 0) {
    return forwarded.split(",")[0]!.trim();
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp && realIp.trim().length > 0) return realIp.trim();
  return "unknown";
}

/** Parse configured limiter options from environment (runtime only). */
export function rateLimitConfigFromEnv(env: NodeJS.ProcessEnv): ApiRateLimitConfig {
  const capacity = Number(env.API_RATE_LIMIT_CAPACITY);
  const refillPerSecond = Number(env.API_RATE_LIMIT_REFILL_PER_SECOND);
  return {
    capacity: Number.isFinite(capacity) && capacity > 0 ? capacity : 120,
    refillPerSecond:
      Number.isFinite(refillPerSecond) && refillPerSecond > 0 ? refillPerSecond : 2,
  };
}