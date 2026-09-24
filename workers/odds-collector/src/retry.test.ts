import { ProviderTransportError } from "@22void/provider-contracts";
import { describe, expect, it, vi } from "vitest";

import { defaultRetryPolicy, isRetryableTransient, retryDelayMs, withRetry } from "./retry.js";

describe("isRetryableTransient", () => {
  it("retries 429 and 5xx statuses", () => {
    expect(isRetryableTransient(new ProviderTransportError("ratelimited", { status: 429 }))).toBe(
      true
    );
    expect(isRetryableTransient(new ProviderTransportError("down", { status: 500 }))).toBe(true);
    expect(isRetryableTransient(new ProviderTransportError("unavail", { status: 503 }))).toBe(true);
  });

  it("does not retry permanent 4xx statuses", () => {
    expect(isRetryableTransient(new ProviderTransportError("bad", { status: 400 }))).toBe(false);
    expect(isRetryableTransient(new ProviderTransportError("missing", { status: 404 }))).toBe(
      false
    );
    expect(isRetryableTransient(new ProviderTransportError("auth", { status: 401 }))).toBe(false);
  });

  it("retries network-level errors (no HTTP status)", () => {
    expect(isRetryableTransient(new ProviderTransportError("connection reset"))).toBe(true);
  });

  it("retries aborts, timeouts and transient socket codes", () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(isRetryableTransient(abort)).toBe(true);

    const reset = new Error("reset") as Error & { code: string };
    reset.code = "ECONNRESET";
    expect(isRetryableTransient(reset)).toBe(true);

    expect(isRetryableTransient(new Error("anything else"))).toBe(false);
  });
});

describe("retryDelayMs", () => {
  const noJitter = { baseDelayMs: 250, maxDelayMs: 2000, jitter: false } as const;

  it("grows exponentially and caps at maxDelayMs", () => {
    expect(retryDelayMs(1, noJitter)).toBe(250);
    expect(retryDelayMs(2, noJitter)).toBe(500);
    expect(retryDelayMs(3, noJitter)).toBe(1000);
    expect(retryDelayMs(4, noJitter)).toBe(2000);
    expect(retryDelayMs(5, noJitter)).toBe(2000);
  });

  it("jitters between 50% and 150% of the scheduled delay", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.0);
    expect(retryDelayMs(2, { ...noJitter, jitter: true })).toBe(250);
    vi.spyOn(Math, "random").mockReturnValue(1.0);
    expect(retryDelayMs(2, { ...noJitter, jitter: true })).toBe(750);
    vi.restoreAllMocks();
  });
});

describe("withRetry", () => {
  const noopSleep = { sleep: async () => {} };

  it("recovers from transient failures", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new ProviderTransportError("flaky", { status: 503 });
      return "ok";
    });
    const result = await withRetry(fn, defaultRetryPolicy(noopSleep));
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("gives up once maxAttempts is exhausted", async () => {
    const err = new ProviderTransportError("down", { status: 500 });
    const fn = vi.fn(async () => {
      throw err;
    });
    await expect(withRetry(fn, defaultRetryPolicy({ maxAttempts: 2, ...noopSleep }))).rejects.toBe(
      err
    );
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("re-raises non-retryable failures immediately", async () => {
    const err = new ProviderTransportError("bad request", { status: 400 });
    const fn = vi.fn(async () => {
      throw err;
    });
    await expect(withRetry(fn, defaultRetryPolicy(noopSleep))).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("reports each retry through onRetry", async () => {
    let calls = 0;
    const seen: number[] = [];
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 2) throw new ProviderTransportError("boom", { status: 500 });
      return "ok";
    });
    const policy = defaultRetryPolicy({
      ...noopSleep,
      jitter: false,
      onRetry: ({ attempt, delayMs }) => seen.push(attempt * 1000 + delayMs),
    });
    await withRetry(fn, policy);
    expect(seen).toEqual([1000 + policy.baseDelayMs]);
  });
});