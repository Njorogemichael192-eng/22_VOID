/**
 * Phase 16 security primitives: per-IP rate limiting, the request guard
 * (method/body/rate/auth layering with audit capture) and the header policy.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

import { describe, expect, it } from "vitest";

import {
  apiContentSecurityPolicy,
  baseSecurityHeaders,
  isApiPath,
  pageContentSecurityPolicy,
} from "./headers";
import { guardRequest } from "./guard";
import { memoryAudit, type SecurityAuditEntry } from "./audit";
import { ApiRateLimiter, clientIp } from "./rate-limit";

const READER_KEY = "reader-secret";
const ADMIN_KEY = "admin-secret";
const env = { apiKey: READER_KEY, adminApiKey: ADMIN_KEY };

function get(url: string, key?: string, ip?: string): Request {
  const headers: Record<string, string> = {};
  if (key) headers["x-api-key"] = key;
  if (ip) headers["x-forwarded-for"] = ip;
  return new Request(url, { headers });
}

function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

/** Drain the guard's fire-and-forget audit writes (microtask only). */
async function settle(): Promise<void> {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
}

// ---------------------------------------------------------------------------
// Rate limiter
// ---------------------------------------------------------------------------

describe("ApiRateLimiter", () => {
  it("allows the burst capacity then blocks with a retry-after", () => {
    const now = 0;
    const limiter = new ApiRateLimiter({ capacity: 3, refillPerSecond: 1, now: () => now });
    expect(limiter.consume("ip:a").allowed).toBe(true);
    expect(limiter.consume("ip:a").allowed).toBe(true);
    expect(limiter.consume("ip:a").allowed).toBe(true);
    const blocked = limiter.consume("ip:a");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(1000);
  });

  it("refills tokens over time", () => {
    let now = 0;
    const limiter = new ApiRateLimiter({ capacity: 1, refillPerSecond: 1, now: () => now });
    expect(limiter.consume("ip:a").allowed).toBe(true);
    expect(limiter.consume("ip:a").allowed).toBe(false);
    now = 1200;
    expect(limiter.consume("ip:a").allowed).toBe(true);
  });

  it("keeps per-caller buckets independent", () => {
    const limiter = new ApiRateLimiter({ capacity: 1, refillPerSecond: 0.1 });
    expect(limiter.consume("ip:a").allowed).toBe(true);
    expect(limiter.consume("ip:a").allowed).toBe(false);
    expect(limiter.consume("ip:b").allowed).toBe(true);
    expect(limiter.size()).toBe(2);
    limiter.reset();
    expect(limiter.size()).toBe(0);
  });
});

describe("clientIp", () => {
  it("takes the first x-forwarded-for hop, falling back to x-real-ip / unknown", () => {
    const forwarded = new Request("http://localhost/", {
      headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
    });
    expect(clientIp(forwarded)).toBe("203.0.113.7");

    expect(
      clientIp(new Request("http://localhost/", { headers: { "x-real-ip": "198.51.100.4" } })),
    ).toBe("198.51.100.4");

    expect(clientIp(new Request("http://localhost/"))).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// Request guard: layering + audit capture
// ---------------------------------------------------------------------------

describe("guardRequest", () => {
  it("rejects a non-GET method with 405 + Allow header, audited", async () => {
    const log: SecurityAuditEntry[] = [];
    const response = guardRequest(
      new Request("http://localhost/api/v1/events", { method: "POST" }),
      { env, security: { audit: memoryAudit(log) } },
    );
    expect(isResponse(response)).toBe(true);
    expect((response as Response).status).toBe(405);
    expect((response as Response).headers.get("allow")).toBe("GET");
    await settle();
    expect(log.some((e) => e.action === "METHOD_NOT_ALLOWED" && e.actor === "unknown")).toBe(true);
  });

  it("rejects a request carrying a body on a read API", () => {
    const response = guardRequest(
      new Request("http://localhost/api/v1/events", {
        method: "GET",
        headers: { "content-length": "10" },
      }),
      { env },
    );
    expect((response as Response).status).toBe(400);
  });

  it("rejects an oversized body with 413", () => {
    const response = guardRequest(
      new Request("http://localhost/api/v1/events", {
        method: "GET",
        headers: { "content-length": "1000000" },
      }),
      { env },
    );
    expect((response as Response).status).toBe(413);
  });

  it("rate-limits per IP and sets Retry-After, audited", async () => {
    const log: SecurityAuditEntry[] = [];
    const limiter = new ApiRateLimiter({ capacity: 2, refillPerSecond: 0.5 });
    const deps = { env, security: { rateLimiter: limiter, audit: memoryAudit(log) } };
    const url = "http://localhost/api/v1/events";

    expect(guardRequest(get(url, READER_KEY, "9.9.9.9"), deps).ok).toBe(true);
    expect(guardRequest(get(url, READER_KEY, "9.9.9.9"), deps).ok).toBe(true);

    const blocked = guardRequest(get(url, READER_KEY, "9.9.9.9"), deps);
    expect(isResponse(blocked)).toBe(true);
    expect((blocked as Response).status).toBe(429);
    expect((blocked as Response).headers.get("retry-after")).toMatch(/^\d+$/);

    await settle();
    expect(log.some((e) => e.action === "RATE_LIMITED" && e.actor === "9.9.9.9")).toBe(true);

    // A different caller is unaffected.
    expect(guardRequest(get(url, READER_KEY, "8.8.8.8"), deps).ok).toBe(true);
  });

  it("answers 401 without a valid key and audits the failure", async () => {
    const log: SecurityAuditEntry[] = [];
    const response = guardRequest(get("http://localhost/api/v1/events"), {
      env,
      security: { audit: memoryAudit(log) },
    });
    expect((response as Response).status).toBe(401);
    await settle();
    expect(log.some((e) => e.action === "AUTH_FAILED")).toBe(true);
  });

  it("answers 403 when a reader calls an admin endpoint and audits it", async () => {
    const log: SecurityAuditEntry[] = [];
    const response = guardRequest(
      get("http://localhost/api/v1/admin/sources", READER_KEY),
      { env, security: { audit: memoryAudit(log) } },
      "admin",
    );
    expect((response as Response).status).toBe(403);
    await settle();
    expect(log.some((e) => e.action === "AUTH_FORBIDDEN")).toBe(true);
  });

  it("admits an admin call and records ADMIN_ACCESS", async () => {
    const log: SecurityAuditEntry[] = [];
    const result = guardRequest(
      get("http://localhost/api/v1/admin/sources", ADMIN_KEY, "10.10.10.10"),
      { env, security: { audit: memoryAudit(log) } },
      "admin",
    );
    expect(result.ok).toBe(true);
    await settle();
    expect(log.some((e) => e.action === "ADMIN_ACCESS" && e.actor === "10.10.10.10")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Header policy
// ---------------------------------------------------------------------------

describe("security headers", () => {
  it("always sends nosniff, frame DENY, referrer and permissions policy", () => {
    const headers = baseSecurityHeaders(false);
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
    expect(headers["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(headers["Strict-Transport-Security"]).toBeUndefined();
  });

  it("adds HSTS only over TLS", () => {
    expect(baseSecurityHeaders(true)["Strict-Transport-Security"]).toContain("max-age=");
  });

  it("locks the page CSP to same-origin with frame ancestors none", () => {
    const csp = pageContentSecurityPolicy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });

  it("uses a scriptless CSP for the JSON API", () => {
    const csp = apiContentSecurityPolicy();
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(isApiPath("/api/v1/events")).toBe(true);
    expect(isApiPath("/dashboard")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Secrets stay server-side
// ---------------------------------------------------------------------------

describe("secrets server-side only", () => {
  const allowedEnvReads = new Set([
    "API_KEY",
    "ADMIN_API_KEY",
    "DASHBOARD_SOURCE",
    "DATABASE_URL",
    "NODE_ENV",
  ]);

  it("never reads a NEXT_PUBLIC_* secret and only reads allowlisted env vars", () => {
    const root = resolve(import.meta.dirname, "..", "..");
    const reads = collectEnvReads(root);
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) {
      expect(read.name.startsWith("NEXT_PUBLIC_")).toBe(false);
      expect(allowedEnvReads.has(read.name)).toBe(true);
    }
  });

  it("exposes no process.env reads from client component files", () => {
    const root = resolve(import.meta.dirname, "..", "..");
    const clientLayer = collectEnvReads(root).filter((read) =>
      read.path.startsWith(`components${sep}`),
    );
    expect(clientLayer).toHaveLength(0);
  });
});

interface EnvRead {
  name: string;
  path: string;
}

function collectEnvReads(root: string): EnvRead[] {
  const findings: EnvRead[] = [];

  const scanFile = (full: string): void => {
    const rel = full.slice(root.length + 1).replace(/\\/g, "/");
    if (/\.test\./.test(rel)) return;
    let content: string;
    try {
      content = readFileSync(full, "utf8");
    } catch {
      return;
    }
    const re = /process\.env\.([A-Z][A-Z0-9_]*)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      findings.push({ name: match[1]!, path: rel });
    }
  };

  const scanDir = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", ".next", "test-results"].includes(entry.name)) continue;
        scanDir(full);
      } else if (/\.(ts|tsx|mts|js)$/.test(entry.name)) {
        scanFile(full);
      }
    }
  };

  for (const dir of ["app", "lib", "components"]) scanDir(join(root, dir));
  scanFile(join(root, "proxy.ts"));
  scanFile(join(root, "middleware.ts"));

  return findings;
}