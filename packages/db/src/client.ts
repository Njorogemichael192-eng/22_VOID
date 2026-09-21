import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client/client";

/**
 * Construct an adapter-based Prisma client for the PostgreSQL (Supabase)
 * datasource. Prisma ORM v7 requires a driver adapter; the connection string
 * is taken from DATABASE_URL.
 */
export function createPrismaClient(connectionString: string): PrismaClient {
  const adapter = new PrismaPg(connectionString);
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
