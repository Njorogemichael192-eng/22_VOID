import { describe, expect, it } from "vitest";
import {
  checkDbHealth,
  createPrismaClient,
  getPrismaClient,
  prisma,
  type DbHealth,
} from "./index.js";

describe("@22void/db", () => {
  it("exposes the DB health shape", () => {
    const health: DbHealth = { reachable: false };
    expect(health.reachable).toBe(false);
  });

  it("exports the client factory and singleton", () => {
    expect(typeof createPrismaClient).toBe("function");
    expect(typeof getPrismaClient).toBe("function");
    expect(prisma).toBeDefined();
    expect(typeof checkDbHealth).toBe("function");
  });
});
