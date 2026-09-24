import { describe, expect, it, vi } from "vitest";

import { TokenBucketRateLimiter } from "./rate-limit.js";

describe("TokenBucketRateLimiter", () => {
  it("allows up to capacity acquisitions without waiting", async () => {
    const now = 0;
    const wait = vi.fn(async () => {});
    const limiter = new TokenBucketRateLimiter({
      capacity: 3,
      refillPerSecond: 1,
      now: () => now,
      delay: wait,
    });
    for (let i = 0; i < 3; i += 1) await limiter.acquire();
    expect(wait).not.toHaveBeenCalled();
    expect(limiter.queuedMs()).toBeGreaterThan(0);
  });

  it("waits for a token when the bucket is empty and refills while waiting", async () => {
    let now = 0;
    const waits: number[] = [];
    const limiter = new TokenBucketRateLimiter({
      capacity: 1,
      refillPerSecond: 1,
      now: () => now,
      delay: async (ms) => {
        waits.push(ms);
        now += ms;
      },
    });

    await limiter.acquire(); // consumes the single token
    await limiter.acquire(); // must wait one second, which refills it
    expect(waits).toEqual([1000]);
    expect(now).toBe(1000);

    await limiter.acquire(); // the waiting refill was consumed → waits again
    expect(waits).toEqual([1000, 1000]);
    expect(now).toBe(2000);
  });

  it("refills tokens over elapsed time", async () => {
    let now = 0;
    const limiter = new TokenBucketRateLimiter({
      capacity: 2,
      refillPerSecond: 10,
      now: () => now,
      delay: async (ms) => {
        now += ms;
      },
    });
    await limiter.acquire();
    await limiter.acquire();
    expect(limiter.queuedMs()).toBeGreaterThan(0);
    now += 100; // +1 token (refillPerSecond/ms * 100ms)
    expect(limiter.queuedMs()).toBe(0);
  });

  it("rejects invalid bucket shapes", () => {
    expect(() => new TokenBucketRateLimiter({ capacity: 0, refillPerSecond: 1 })).toThrow(
      "capacity must be positive"
    );
    expect(() => new TokenBucketRateLimiter({ capacity: 1, refillPerSecond: 0 })).toThrow(
      "refillPerSecond must be positive"
    );
  });
});