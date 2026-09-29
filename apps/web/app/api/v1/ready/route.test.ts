import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { resetReadinessCache } from "@/lib/api/handlers/system";

const checkDbHealth = vi.fn(async () => ({ reachable: true, latencyMs: 1 }));

vi.mock("@22void/db", () => ({
  checkDbHealth: (...args: unknown[]) => checkDbHealth(...(args as [])),
}));

function probeWith(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/v1/ready", { headers });
}

beforeEach(() => {
  checkDbHealth.mockClear();
  checkDbHealth.mockResolvedValue({ reachable: true, latencyMs: 1 });
  process.env.DATABASE_URL = "postgresql://user:pass@db.internal:5432/void";
  resetReadinessCache();
});

describe("GET /api/v1/ready", () => {
  it("serves an internal caller and reports the database as reachable", async () => {
    const response = await GET(probeWith({ "x-forwarded-for": "172.20.0.3" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "ok" });
  });

  it("refuses a public caller without touching the database", async () => {
    const response = await GET(probeWith({ "x-forwarded-for": "203.0.113.9" }));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "FORBIDDEN" } });
    expect(checkDbHealth).not.toHaveBeenCalled();
  });

  it("refuses a caller that cannot be identified", async () => {
    const response = await GET(probeWith({}));
    expect(response.status).toBe(403);
    expect(checkDbHealth).not.toHaveBeenCalled();
  });

  it("never lets a proxy cache the verdict", async () => {
    const response = await GET(probeWith({ "x-forwarded-for": "127.0.0.1" }));
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
  });

  it("reports not-ready when the probe fails, for an internal caller", async () => {
    checkDbHealth.mockResolvedValue({ reachable: false, latencyMs: 0 });
    const response = await GET(probeWith({ "x-forwarded-for": "127.0.0.1" }));
    expect(response.status).toBe(503);
  });
});
