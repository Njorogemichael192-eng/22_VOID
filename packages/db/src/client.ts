import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client/client";

/**
 * The subset of `pg.PoolConfig` worth exposing to callers that manage their own
 * pool. Kept narrow on purpose: the application singleton wants libpq/pg
 * defaults, while a health probe wants a hard ceiling on connections.
 */
export interface PrismaPoolOptions {
  /** Maximum connections the pool may hold open. */
  max?: number;
  /** How long to wait for a free connection before failing. */
  connectionTimeoutMillis?: number;
  /** Close connections that have been idle this long. */
  idleTimeoutMillis?: number;
}

/**
 * Construct an adapter-based Prisma client for the PostgreSQL (Supabase)
 * datasource. Prisma ORM v7 requires a driver adapter; the connection string
 * is taken from DATABASE_URL.
 */
export function createPrismaClient(
  connectionString: string,
  pool?: PrismaPoolOptions
): PrismaClient {
  const adapter =
    pool === undefined
      ? new PrismaPg(connectionString)
      : new PrismaPg({ connectionString, ...pool });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient | undefined;
};

/**
 * Return the process-wide Prisma client singleton. Forwards the singleton to
 * the driver adapter; defaults to a placeholder URL so importing @22void/db
 * never crashes in environments without a DATABASE_URL (any real query on an
 * unset connection still fails loudly at the driver).
 */
export function getPrismaClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    const connectionString =
      process.env.DATABASE_URL ?? "postgresql://unset:unset@localhost:5432/unset";
    globalForPrisma.prisma = createPrismaClient(connectionString);
  }
  return globalForPrisma.prisma;
}

/** Shared client instance used across the app and workers (see ARCHITECTURE.md). */
export const prisma = getPrismaClient();
