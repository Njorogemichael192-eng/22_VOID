/**
 * Apps/web security audit port (Phase 16).
 *
 * The API guard records security events (rate-limit blocks, auth failures,
 * admin access) through this small port. Production wires the Postgres-backed
 * writer; tests inject an in-memory capture to assert what was logged. Writes
 * are best-effort and async — a rejected audit write never changes the
 * HTTP response the guard already decided.
 */

import { getPrismaClient, writeAuditLog } from "@22void/db";

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

/** Postgres-backed writer via @22void/db (fail-soft on unreachable DB). */
export function dbAudit(): SecurityAudit {
  return {
    async record(entry) {
      const normalized: SecurityAuditEntry = {
        ...entry,
        entityType: entry.entityType ?? SECURITY_ENTITY,
      };
      try {
        await writeAuditLog(getPrismaClient(), normalized);
      } catch (error) {
        console.warn("[security] audit write failed", error);
      }
    },
  };
}