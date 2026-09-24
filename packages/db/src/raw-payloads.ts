import type { PrismaClient } from "./generated/client/client";
import type { Prisma } from "./generated/client/client";

/**
 * Raw payload persistence (Phase 3, spec §65).
 *
 * The collector stores the verbatim provider wire payload for every poll so
 * later phases can replay diagnostics without re-hitting the provider. The
 * provider identity is the existing `oddsSource` row (FK-restricted), so a
 * running system must ensure the source exists first (operator bootstrap or
 * uidempotent service startup — Phase 14 concern).
 */

/** A connected Prisma client or the callback client of an open transaction. */
export type DbLike = PrismaClient | Prisma.TransactionClient;

export interface StoreRawPayloadInput {
  db: PrismaClient | Prisma.TransactionClient;
  oddsSourceId: string;
  requestId?: string;
  endpoint?: string;
  payload: Prisma.InputJsonValue;
  receivedAt?: Date;
}

export async function storeRawPayload(
  input: StoreRawPayloadInput
): Promise<{ id: string; requestId: string | null; receivedAt: Date }> {
  const row = await input.db.rawPayload.create({
    data: {
      oddsSourceId: input.oddsSourceId,
      requestId: input.requestId ?? null,
      endpoint: input.endpoint ?? null,
      payload: input.payload,
      receivedAt: input.receivedAt ?? new Date(),
    },
    select: { id: true, requestId: true, receivedAt: true },
  });
  return row;
}

export interface OddsSourceLink {
  id: string;
  key: string;
}

/** Find or create an odds source by its unique key (idempotent). */
export async function ensureOddsSource(
  db: PrismaClient | Prisma.TransactionClient,
  key: string,
  displayName?: string
): Promise<OddsSourceLink> {
  const existing = await db.oddsSource.findUnique({ where: { key } });
  if (existing !== null) {
    return { id: existing.id, key: existing.key };
  }
  const created = await db.oddsSource.create({
    data: { key, displayName: displayName ?? key },
  });
  return { id: created.id, key: created.key };
}
