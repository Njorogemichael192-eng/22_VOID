/**
 * @22void/db — general audit-log writes (Phase 16).
 *
 * Phase 12/14 already write audit entries attached to opportunities (the §66
 * opportunity reconstruction trail). This module covers *security* audit events
 * that are not tied to an opportunity: rate-limit blocks, failed/missing API
 * authentication, forbidden admin access, and successful admin operations.
 *
 * `AuditLog.entityType` defaults to the conventional "security" label so the
 * existing `GET /api/v1/admin/audit-logs?entityType=security` filter surfaces
 * them; callers may choose another entity type.
 */

import type { Prisma, PrismaClient } from "./generated/client/client";

export interface WriteAuditLogInput {
  action: string;
  actor?: string;
  entityType?: string;
  entityId?: string;
  detail?: Prisma.InputJsonValue;
  createdAt?: string;
}

export interface AuditQueueOptions {
  /** Rows held in memory awaiting a drain. Default 1000. */
  readonly maxQueueSize?: number;
  /** Rows written per drain. Default 64. */
  readonly batchSize?: number;
  /** Longest a row may sit in the queue before it is dropped. Default 30s. */
  readonly maxQueueAgeMs?: number;
}

export interface AuditQueueStats {
  readonly queueDepth: number;
  readonly droppedQueueFull: number;
  readonly droppedTooOld: number;
  readonly writeFailures: number;
  readonly drained: number;
  readonly inFlight: boolean;
}

/**
 * Thrown by the writer handed to `enqueueAuditLog`. Typed so the queue can tell a
 * caller-side rejection (drop the row, keep serving) apart from a database
 * outage (retry the row, bounded by `maxQueueAgeMs`).
 */
export class AuditWriteError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "AuditWriteError";
  }
}

const DEFAULT_MAX_QUEUE_SIZE = 1000;
const DEFAULT_BATCH_SIZE = 64;
const DEFAULT_MAX_QUEUE_AGE_MS = 30_000;

/** Reported when a row is shed so an operator can alert on it. */
function warnShed(reason: string, action: string, extra: Record<string, unknown>): void {
  console.warn(
    `[audit] dropped security audit row (${reason}) action=${action} ${JSON.stringify(extra)}`
  );
}

/**
 * Buffer audit writes behind a bounded queue.
 *
 * `writeAuditLog` awaited the database inline, and the guard fires it with
 * `void`, so nothing observed the resulting promise. Every queued row is a closure
 * retaining its `detail` object: when the database stalled, each request added
 * another pending write and the process grew until it was OOM-killed. The queue
 * caps that at `maxQueueSize` rows and sheds the rest.
 *
 * Shedding is deliberate rather than back-pressuring. These are best-effort
 * security events, and the caller has already been answered — blocking the HTTP
 * response to preserve an audit row would trade a bounded DoS for an unbounded
 * availability one. Every shed increments a counter and logs at most once per
 * drain, so the loss is visible instead of silent.
 */
export function createAuditQueue(
  write: (input: WriteAuditLogInput) => Promise<void>,
  options: AuditQueueOptions = {}
): {
  readonly enqueue: (input: WriteAuditLogInput) => void;
  readonly stats: () => AuditQueueStats;
} {
  const maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxQueueAgeMs = options.maxQueueAgeMs ?? DEFAULT_MAX_QUEUE_AGE_MS;

  if (maxQueueSize <= 0 || batchSize <= 0 || maxQueueAgeMs <= 0) {
    throw new Error("audit queue limits must be positive");
  }

  interface QueuedRow {
    readonly input: WriteAuditLogInput;
    readonly enqueuedAt: number;
  }

  // Bounded by construction: the only push site checks length first, so the array
  // can never exceed maxQueueSize entries.
  const queue: QueuedRow[] = [];
  let droppedQueueFull = 0;
  let droppedTooOld = 0;
  let writeFailures = 0;
  let drained = 0;
  let draining = false;
  let inflight = false;
  let pendingDrain = false;
  let warnedThisDrain = false;

  const shedOld = (now: number): void => {
    while (queue.length > 0 && now - queue[0]!.enqueuedAt > maxQueueAgeMs) {
      const row = queue.shift()!;
      droppedTooOld += 1;
      warnShed("too old", row.input.action, {
        waitedMs: now - row.enqueuedAt,
        queuedAt: row.enqueuedAt,
        now,
      });
    }
  };

  /** Returns true when a retryable failure left a row queued for a later pass. */
  const persist = async (): Promise<boolean> => {
    const now = Date.now();
    shedOld(now);
    const batch = queue.splice(0, batchSize);
    if (batch.length === 0) return false;
    let retryPending = false;
    for (const row of batch) {
      try {
        await write(row.input);
        drained += 1;
      } catch (error) {
        const retryable =
          error instanceof AuditWriteError
            ? error.retryable
            : // An untyped rejection is assumed to be the database rather than the
              // caller's payload, but only for this round: the row is not
              // requeued indefinitely, so there is no unbounded retry either way.
              true;
        if (retryable) {
          if (now - row.enqueuedAt > maxQueueAgeMs) {
            droppedTooOld += 1;
            warnShed("write kept failing", row.input.action, { waitedMs: now - row.enqueuedAt });
            continue;
          }
          queue.unshift(row);
          retryPending = true;
        }
        writeFailures += 1;
        console.warn(`[audit] write failed for action=${row.input.action}`, error);
      }
    }
    return retryPending;
  };

  const drain = async (): Promise<void> => {
    // A drain already in progress means rows arrived mid-drain. Setting the flag
    // makes that drain loop again, so no row is stranded while the queue drains.
    if (draining) {
      pendingDrain = true;
      return;
    }
    draining = true;
    inflight = true;
    try {
      do {
        pendingDrain = false;
        while (queue.length > 0) {
          const retryPending = await persist();
          // Abandon this pass after a retryable failure. Re-attempting in a tight
          // loop against a database that is already failing would peg a core and
          // starve the very requests that are generating the rows; the next
          // enqueue starts a fresh pass instead.
          if (retryPending) break;
          if (queue.length >= maxQueueSize) break;
        }
      } while (pendingDrain && queue.length > 0);
    } finally {
      draining = false;
      inflight = false;
    }
  };

  return {
    enqueue(input: WriteAuditLogInput): void {
      if (queue.length >= maxQueueSize) {
        droppedQueueFull += 1;
        if (!warnedThisDrain) {
          warnedThisDrain = true;
          console.warn(
            `[audit] queue full (${maxQueueSize}); shedding security audit rows until it drains`
          );
        }
        return;
      }
      queue.push({ input, enqueuedAt: Date.now() });
      void drain();
    },
    stats(): AuditQueueStats {
      return {
        queueDepth: queue.length,
        droppedQueueFull,
        droppedTooOld,
        writeFailures,
        drained,
        inFlight: inflight,
      };
    },
  };
}

/**
 * Insert one audit row. Best-effort by convention: callers treat a rejected
 * write as a logged event lost rather than a request failure — security
 * responses (401/403/429) are authoritative regardless of the audit store.
 */
export async function writeAuditLog(
  db: PrismaClient | Prisma.TransactionClient,
  input: WriteAuditLogInput
): Promise<void> {
  await db.auditLog.create({
    data: {
      ...(input.actor !== undefined ? { actor: input.actor } : {}),
      ...(input.entityType !== undefined ? { entityType: input.entityType } : {}),
      ...(input.entityId !== undefined ? { entityId: input.entityId } : {}),
      action: input.action,
      ...(input.detail !== undefined ? { detail: input.detail } : {}),
      ...(input.createdAt !== undefined ? { createdAt: new Date(input.createdAt) } : {}),
    },
  });
}

/**
 * A queued audit writer bound to one database handle, plus its stats.
 *
 * Note the queue is a per-handle singleton here: two calls create two queues, so
 * a process that wants one shared buffer should create it once at wiring time
 * (`apps/web/lib/api/runtime.ts` does) rather than per request.
 */
export function enqueueAuditLog(
  db: PrismaClient | Prisma.TransactionClient,
  options?: AuditQueueOptions
): {
  readonly enqueue: (input: WriteAuditLogInput) => void;
  readonly stats: () => AuditQueueStats;
} {
  return createAuditQueue((input) => writeAuditLog(db, input), options);
}
