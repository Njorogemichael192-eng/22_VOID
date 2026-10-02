/**
 * Phase 18: bounded audit write queue.
 *
 * The guard fires audit writes with `void`, so an inline insert left one
 * unobserved pending promise per rejected request. These tests pin the two
 * properties that make that safe: memory stays bounded, and a stalled database
 * never turns into unbounded memory or unbounded retry.
 */

import { describe, expect, it } from "vitest";

import { AuditWriteError, createAuditQueue } from "./audit";

/** Resolves after the microtask queue and one macrotask turn have passed. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("createAuditQueue", () => {
  it("drains queued rows to the writer", async () => {
    const written: string[] = [];
    const queue = createAuditQueue(async (input) => {
      written.push(input.action);
    });

    queue.enqueue({ action: "AUTH_FAILED", actor: "1.1.1.1" });
    queue.enqueue({ action: "ADMIN_ACCESS", actor: "1.1.1.1" });
    await settle();

    expect(written).toEqual(["AUTH_FAILED", "ADMIN_ACCESS"]);
    expect(queue.stats().drained).toBe(2);
    expect(queue.stats().queueDepth).toBe(0);
  });

  it("never enqueues more than maxQueueSize rows", async () => {
    // A writer that never resolves: the worst case the queue exists for.
    const queue = createAuditQueue(() => new Promise<void>(() => {}), { maxQueueSize: 10 });

    for (let i = 0; i < 1000; i += 1) {
      queue.enqueue({ action: "RATE_LIMITED", actor: `10.0.0.${i % 255}` });
    }

    const stats = queue.stats();
    expect(stats.queueDepth).toBeLessThanOrEqual(10);
    expect(stats.droppedQueueFull).toBeGreaterThan(0);
    // Everything offered is either queued, shed, or the single row currently
    // awaiting a write that will never resolve — the drain holds at most one
    // batch outside the queue, so the bound holds either way.
    expect(stats.queueDepth + stats.droppedQueueFull).toBeLessThanOrEqual(1000);
    expect(stats.queueDepth + stats.droppedQueueFull).toBeGreaterThanOrEqual(990);
  });

  it("sheds rows that have waited longer than maxQueueAgeMs", async () => {
    // The first write is held open so the second row waits in the queue, which is
    // the only way a row can age: a fully stalled drain never runs shedOld, and
    // the maxQueueSize guard is what bounds the queue in that case.
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queue = createAuditQueue(
      async () => {
        await gate;
      },
      { maxQueueSize: 50, maxQueueAgeMs: 1 }
    );

    queue.enqueue({ action: "FIRST" });
    queue.enqueue({ action: "SECOND" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    release?.();
    await settle();
    await settle();

    expect(queue.stats().droppedTooOld).toBe(1);
    expect(queue.stats().queueDepth).toBe(0);
  });

  it("retries a retryable write failure without unbounded growth", async () => {
    let attempts = 0;
    const queue = createAuditQueue(
      async () => {
        attempts += 1;
        throw new AuditWriteError("database is down", true);
      },
      { maxQueueSize: 5, maxQueueAgeMs: 10_000 }
    );

    queue.enqueue({ action: "AUTH_FAILED" });
    for (let i = 0; i < 20; i += 1) {
      queue.enqueue({ action: "RATE_LIMITED" });
      await settle();
    }

    // The failed row is retried, but the queue never exceeds its bound and the
    // retry loop is driven by new arrivals rather than spinning on its own.
    expect(queue.stats().queueDepth).toBeLessThanOrEqual(5);
    expect(attempts).toBeGreaterThan(1);
  });

  it("drops a non-retryable write failure instead of requeueing it forever", async () => {
    let attempts = 0;
    const queue = createAuditQueue(
      async () => {
        attempts += 1;
        throw new AuditWriteError("value too long for column", false);
      },
      { maxQueueSize: 10, maxQueueAgeMs: 10_000 }
    );

    queue.enqueue({ action: "AUTH_FAILED" });
    await settle();
    await settle();

    expect(attempts).toBe(1);
    expect(queue.stats().queueDepth).toBe(0);
    expect(queue.stats().writeFailures).toBe(1);
  });

  it("keeps draining rows that arrive while a drain is in flight", async () => {
    const written: string[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queue = createAuditQueue(async (input) => {
      // Hold the first write open so later enqueues land mid-drain.
      if (written.length === 0) await gate;
      written.push(input.action);
    });

    queue.enqueue({ action: "FIRST" });
    queue.enqueue({ action: "SECOND" });
    await settle();
    release?.();
    await settle();
    await settle();

    expect(written).toContain("FIRST");
    expect(written).toContain("SECOND");
    expect(queue.stats().queueDepth).toBe(0);
  });

  it("rejects nonsensical limits rather than silently misbehaving", () => {
    expect(() => createAuditQueue(async () => {}, { maxQueueSize: 0 })).toThrow();
    expect(() => createAuditQueue(async () => {}, { batchSize: -1 })).toThrow();
    expect(() => createAuditQueue(async () => {}, { maxQueueAgeMs: 0 })).toThrow();
  });
});
