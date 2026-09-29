/**
 * Apps/web security audit port (Phase 16).
 *
 * The API guard records security events (rate-limit blocks, auth failures, wrong
 * method, bad body, admin access) through this small port. Production wires the
 * Postgres-backed writer; tests inject an in-memory capture to assert what was
 * logged. Writes are best-effort and async — a rejected audit write never changes
 * the HTTP response the guard already decided.
 *
 * Two independent controls keep audit writes from becoming a denial-of-service
 * lever, and they are deliberately separate:
 *
 *   1. *Who* may cause a write. The guard (lib/security/guard.ts) refuses to audit
 *      pre-authentication rejections such as a wrong-method POST, and throttles
 *      the ones an anonymous caller can still reach. This is the control that
 *      stops write amplification at the source.
 *   2. *How fast* writes drain. `enqueueAuditLog` in @22void/db buffers writes
 *      through a bounded queue, so a slow or stalled database cannot grow the
 *      process heap without limit.
 *
 * The queue bounds memory; it does not bound the database write rate. Control (1)
 * is what does that, which is why the guard change is the substantive fix here.
 */

import { enqueueAuditLog, getPrismaClient } from "@22void/db";

import type { WriteAuditLogInput } from "@22void/db";

export type SecurityAuditEntry = WriteAuditLogInput;

export interface SecurityAudit {
  record(entry: SecurityAuditEntry): Promise<void>;
}

/** Conventional entity type for API security events. */
export const SECURITY_ENTITY = "security";

/** No-op writer (default fallback). */
export const nullAudit: SecurityAudit = {
  async record() {
    /* nothing to persist */
  },
};

/** In-memory capture for tests. */
export function memoryAudit(log: SecurityAuditEntry[] = []): SecurityAudit {
  return {
    async record(entry) {
      log.push(entry);
    },
  };
}

let queuedWriter: ReturnType<typeof enqueueAuditLog> | undefined;
let writerUnavailable = false;

/**
 * Postgres-backed writer via @22void/db.
 *
 * Writes go through `enqueueAuditLog`'s bounded queue rather than awaiting the
 * insert inline. The guard calls `record` with `void`, so an inline insert left
 * one unobserved pending promise per rejected request; a stalled database then
 * grew the heap until the process died. The queue caps that and sheds the excess,
 * which is the right trade for best-effort security events whose HTTP response
 * has already been sent.
 *
 * The queue is built lazily on the first write and memoised, so the whole process
 * shares one buffer — building one per call would give every caller its own
 * backlog and bound nothing. Building it lazily also keeps the failure mode the
 * old inline writer had: `dbAudit()` is called at module scope in
 * `lib/api/runtime.ts`, so constructing the Prisma client eagerly would throw
 * during import and 500 every route when `DATABASE_URL` is missing or invalid.
 */
export function dbAudit(): SecurityAudit {
  return {
    async record(entry) {
      if (writerUnavailable) return;
      if (!queuedWriter) {
        try {
          queuedWriter = enqueueAuditLog(getPrismaClient());
        } catch (error) {
          // Latched, so a misconfigured deployment warns once rather than on
          // every rejected request.
          writerUnavailable = true;
          console.warn(
            "[security] audit writer unavailable; security events will not be persisted",
            error,
          );
          return;
        }
      }
      queuedWriter.enqueue({
        ...entry,
        entityType: entry.entityType ?? SECURITY_ENTITY,
      });
    },
  };
}