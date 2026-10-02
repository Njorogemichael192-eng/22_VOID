import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaPg } from "@prisma/adapter-pg";
import type * as GeneratedClient from "./generated/client/client";
import { checkDbHealth, closeHealthProbeClients } from "./index.js";

// Hoisted with the mock factories above, which run before the module body.
const { queryRaw, disconnect, constructorArgs } = vi.hoisted(() => ({
  queryRaw: vi.fn(async () => [{ "1": 1 }]),
  disconnect: vi.fn(async () => undefined),
  constructorArgs: [] as unknown[][],
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class {
    constructor(...args: unknown[]) {
      constructorArgs.push(args);
    }
  },
}));

vi.mock("./generated/client/client.js", async (importOriginal) => {
  // Everything the module actually reads (enums, runtime types) must stay real;
  // only the network-facing client is replaced.
  const actual = (await importOriginal()) as typeof GeneratedClient;
  return {
    ...actual,
    PrismaClient: class {
      $queryRaw = queryRaw;
      $disconnect = disconnect;
    },
  };
});

type PoolConfig = ConstructorParameters<typeof PrismaPg>[0];

const URL_A = "postgresql://user:pass@db.internal:5432/void";
const URL_B = "postgresql://user:pass@other.internal:5432/void";

beforeEach(async () => {
  queryRaw.mockClear();
  disconnect.mockClear();
  constructorArgs.length = 0;
  process.env.DATABASE_URL = URL_A;
  await closeHealthProbeClients();
});

afterEach(async () => {
  await closeHealthProbeClients();
  delete process.env.DATABASE_URL;
});

function firstPoolConfig(): PoolConfig {
  const first = constructorArgs[0]?.[0];
  if (typeof first !== "object" || first === null) {
    throw new Error(`expected a pool config, received ${String(first)}`);
  }
  return first as PoolConfig;
}

describe("checkDbHealth pooling", () => {
  it("reports the database reachable when SELECT 1 succeeds", async () => {
    const health = await checkDbHealth(URL_A);
    expect(health.reachable).toBe(true);
    expect(health.latencyMs).toBeTypeOf("number");
  });

  it("reuses one pool across repeated probes", async () => {
    for (let i = 0; i < 50; i += 1) {
      await checkDbHealth(URL_A);
    }
    expect(queryRaw).toHaveBeenCalledTimes(50);
    // One adapter for the whole burst, not one per probe.
    expect(constructorArgs).toHaveLength(1);
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("caps the probe pool at a small ceiling", async () => {
    await checkDbHealth(URL_A);
    const config = firstPoolConfig() as { max?: number; connectionString?: string };
    expect(config.max).toBe(2);
    expect(config.connectionString).toContain("db.internal");
  });

  it("does not share a pool across different databases", async () => {
    await checkDbHealth(URL_A);
    await checkDbHealth(URL_B);
    expect(constructorArgs).toHaveLength(2);
  });

  it("does not share a pool across different probe budgets", async () => {
    await checkDbHealth(URL_A, { timeoutMs: 2_000 });
    await checkDbHealth(URL_A, { timeoutMs: 5_000 });
    expect(constructorArgs).toHaveLength(2);
  });

  it("keeps the pool after a failed probe so the next one can retry", async () => {
    queryRaw.mockRejectedValueOnce(new Error("server closed the connection unexpectedly"));
    const failed = await checkDbHealth(URL_A);
    expect(failed.reachable).toBe(false);
    expect(disconnect).not.toHaveBeenCalled();

    const recovered = await checkDbHealth(URL_A);
    expect(recovered.reachable).toBe(true);
    expect(constructorArgs).toHaveLength(1);
  });

  it("forces a libpq connect timeout onto the URL", async () => {
    await checkDbHealth(URL_A, { timeoutMs: 2_000 });
    expect(firstPoolConfig()).toMatchObject({ connectionTimeoutMillis: 2_000 });
    expect(String((firstPoolConfig() as { connectionString: string }).connectionString)).toContain(
      "connect_timeout=2"
    );
  });

  it("closes every cached pool on request", async () => {
    await checkDbHealth(URL_A);
    await checkDbHealth(URL_B);
    await closeHealthProbeClients();
    expect(disconnect).toHaveBeenCalledTimes(2);

    disconnect.mockClear();
    await checkDbHealth(URL_A);
    expect(constructorArgs).toHaveLength(3);
  });
});
