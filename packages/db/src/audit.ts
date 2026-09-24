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

/**
 * Insert one audit row. Best-effort by convention: callers treat a rejected
 * write as a logged event lost rather than a request failure — security
 * responses (401/403/429) are authoritative regardless of the audit store.
 */
export async function writeAuditLog(
  db: PrismaClient | Prisma.TransactionClient,
  input: WriteAuditLogInput,
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