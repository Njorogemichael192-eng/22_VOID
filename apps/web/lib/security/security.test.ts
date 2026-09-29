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
import {
  guardRequest,
  resetGuardAuditThrottle,
  UNAUTHENTICATED_AUDIT_INTERVAL_MS,
} from "./guard";
import { memoryAudit, type SecurityAuditEntry } from "./audit";
import {
  ApiRateLimiter,
  clientIp,
  rateLimitConfigFromEnv,
  DEFAULT_API_RATE_LIMIT_CAPACITY,
  DEFAULT_API_RATE_LIMIT_REFILL_PER_SECOND,
} from "./rate-limit";

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

describe("rateLimitConfigFromEnv", () => {
  it("falls back to the documented defaults when unset or blank", () => {
    expect(rateLimitConfigFromEnv({})).toEqual({
      capacity: DEFAULT_API_RATE_LIMIT_CAPACITY,
      refillPerSecond: DEFAULT_API_RATE_LIMIT_REFILL_PER_SECOND,
    });
    expect(rateLimitConfigFromEnv({ API_RATE_LIMIT_CAPACITY: "  " })).toEqual({
      capacity: DEFAULT_API_RATE_LIMIT_CAPACITY,
      refillPerSecond: DEFAULT_API_RATE_LIMIT_REFILL_PER_SECOND,
    });
  });

  it("honours configured values", () => {
    expect(
      rateLimitConfigFromEnv({
        API_RATE_LIMIT_CAPACITY: "30",
        API_RATE_LIMIT_REFILL_PER_SECOND: "0.5",
      }),
    ).toEqual({ capacity: 30, refillPerSecond: 0.5 });
  });

  it("refuses to silently fall back on a malformed value", () => {
    // The regression this guards: a typo used to yield the in-code default,
    // which for a security control is a limit looser than intended and a log
    // with nothing in it.
    expect(() => rateLimitConfigFromEnv({ API_RATE_LIMIT_CAPACITY: "120/min" })).toThrow(
      /Invalid API_RATE_LIMIT_CAPACITY/,
    );
    expect(() => rateLimitConfigFromEnv({ API_RATE_LIMIT_CAPACITY: "0" })).toThrow(
      /Invalid API_RATE_LIMIT_CAPACITY/,
    );
    expect(() => rateLimitConfigFromEnv({ API_RATE_LIMIT_CAPACITY: "-5" })).toThrow(
      /Invalid API_RATE_LIMIT_CAPACITY/,
    );
    expect(() => rateLimitConfigFromEnv({ API_RATE_LIMIT_REFILL_PER_SECOND: "fast" })).toThrow(
      /Invalid API_RATE_LIMIT_REFILL_PER_SECOND/,
    );
  });

  it("ignores the worker's RATE_LIMIT_* names", () => {
    // They guard outbound provider polling in the collector, not inbound API
    // traffic. Accepting them here is how the public API stayed on defaults.
    const config = rateLimitConfigFromEnv({
      RATE_LIMIT_CAPACITY: "10",
      RATE_LIMIT_REFILL_PER_SECOND: "5",
    });
    expect(config.capacity).toBe(DEFAULT_API_RATE_LIMIT_CAPACITY);
    expect(config.refillPerSecond).toBe(DEFAULT_API_RATE_LIMIT_REFILL_PER_SECOND);
  });
});

// ---------------------------------------------------------------------------
// Request guard: layering + audit capture
// ---------------------------------------------------------------------------

describe("guardRequest", () => {
  it("rejects a non-GET method with 405 + Allow header, audited for an authenticated caller", async () => {
    const log: SecurityAuditEntry[] = [];
    const response = guardRequest(
      new Request("http://localhost/api/v1/events", {
        method: "POST",
        headers: { "x-api-key": READER_KEY },
      }),
      { env, security: { audit: memoryAudit(log) } },
    );
    expect(isResponse(response)).toBe(true);
    expect((response as Response).status).toBe(405);
    expect((response as Response).headers.get("allow")).toBe("GET");
    await settle();
    expect(log.some((e) => e.action === "METHOD_NOT_ALLOWED")).toBe(true);
  });

  it("answers 405 to an unauthenticated POST but writes no audit row", async () => {
    // Phase 18: auditing this pre-auth rejection let an unauthenticated flood
    // amplify into one auditLog.create per request.
    const log: SecurityAuditEntry[] = [];
    const response = guardRequest(new Request("http://localhost/api/v1/events", { method: "POST" }), {
      env,
      security: { audit: memoryAudit(log) },
    });
    expect((response as Response).status).toBe(405);
    expect((response as Response).headers.get("allow")).toBe("GET");
    await settle();
    expect(log).toHaveLength(0);
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

  it("throttles 429 audit rows so a flood cannot flood the audit table", async () => {
    resetGuardAuditThrottle();
    const log: SecurityAuditEntry[] = [];
    const limiter = new ApiRateLimiter({ capacity: 1, refillPerSecond: 0.01 });
    let at = 1_000_000;
    const deps = {
      env,
      security: { rateLimiter: limiter, audit: memoryAudit(log), now: () => at },
    };
    const url = "http://localhost/api/v1/events";

    expect(guardRequest(get(url, READER_KEY, "7.7.7.7"), deps).ok).toBe(true);
    for (let i = 0; i < 500; i += 1) {
      const blocked = guardRequest(get(url, READER_KEY, "7.7.7.7"), deps);
      expect((blocked as Response).status).toBe(429);
      at += 5;
    }
    await settle();
    expect(log.filter((e) => e.action === "RATE_LIMITED")).toHaveLength(1);

    at += UNAUTHENTICATED_AUDIT_INTERVAL_MS + 1;
    expect((guardRequest(get(url, READER_KEY, "7.7.7.7"), deps) as Response).status).toBe(429);
    await settle();
    expect(log.filter((e) => e.action === "RATE_LIMITED")).toHaveLength(2);
    resetGuardAuditThrottle();
  });

  it("rate-limits a rejected-method flood before it can write audit rows", async () => {
    resetGuardAuditThrottle();
    const log: SecurityAuditEntry[] = [];
    const limiter = new ApiRateLimiter({ capacity: 2, refillPerSecond: 0.5 });
    const deps = { env, security: { rateLimiter: limiter, audit: memoryAudit(log) } };
    const url = "http://localhost/api/v1/events";
    const post = (ip: string) =>
      new Request(url, { method: "POST", headers: { "x-forwarded-for": ip } });

    expect((guardRequest(post("6.6.6.6"), deps) as Response).status).toBe(405);
    expect((guardRequest(post("6.6.6.6"), deps) as Response).status).toBe(405);

    for (let i = 0; i < 50; i += 1) {
      expect((guardRequest(post("6.6.6.6"), deps) as Response).status).toBe(429);
    }

    await settle();
    // The two in-budget POSTs are unauthenticated, so neither audits any more.
    expect(log.filter((e) => e.action === "METHOD_NOT_ALLOWED")).toHaveLength(0);
    expect(log.filter((e) => e.action === "RATE_LIMITED")).toHaveLength(1);
    resetGuardAuditThrottle();
  });

  it("writes no audit rows for a large unauthenticated POST flood", async () => {
    // The headline Phase 18 property: an unauthenticated flood of wrong-method
    // requests must not be able to turn rejections into database writes.
    resetGuardAuditThrottle();
    const log: SecurityAuditEntry[] = [];
    const limiter = new ApiRateLimiter({ capacity: 10_000, refillPerSecond: 10_000 });
    const deps = { env, security: { rateLimiter: limiter, audit: memoryAudit(log) } };
    const url = "http://localhost/api/v1/events";

    for (let i = 0; i < 1000; i += 1) {
      const response = guardRequest(
        new Request(url, {
          method: "POST",
          // A rotating forwarded-for, which is what an attacker spoofing the
          // rate-limit key would do.
          headers: { "x-forwarded-for": `10.0.0.${i % 255}` },
        }),
        deps,
      );
      expect((response as Response).status).toBe(405);
    }

    await settle();
    expect(log).toHaveLength(0);
    resetGuardAuditThrottle();
  });

  it("throttles AUTH_FAILED so a keyless flood cannot flood the audit table", async () => {
    resetGuardAuditThrottle();
    const log: SecurityAuditEntry[] = [];
    let at = 1_000;
    const limiter = new ApiRateLimiter({ capacity: 10_000, refillPerSecond: 10_000 });
    const deps = {
      env,
      security: { rateLimiter: limiter, audit: memoryAudit(log), now: () => at },
    };
    const url = "http://localhost/api/v1/events";

    for (let i = 0; i < 200; i += 1) {
      expect((guardRequest(get(url, undefined, "5.5.5.5"), deps) as Response).status).toBe(401);
    }
    await settle();
    expect(log.filter((e) => e.action === "AUTH_FAILED")).toHaveLength(1);

    // Still throttled just inside the window, then allowed again after it.
    at += UNAUTHENTICATED_AUDIT_INTERVAL_MS - 1;
    expect((guardRequest(get(url, undefined, "5.5.5.5"), deps) as Response).status).toBe(401);
    await settle();
    expect(log.filter((e) => e.action === "AUTH_FAILED")).toHaveLength(1);

    at += 2;
    expect((guardRequest(get(url, undefined, "5.5.5.5"), deps) as Response).status).toBe(401);
    await settle();
    expect(log.filter((e) => e.action === "AUTH_FAILED")).toHaveLength(2);
    resetGuardAuditThrottle();
  });

  it("still audits a wrong-method request that carries a valid key", async () => {
    // The gate must not be so blunt that it silences real authenticated clients.
    resetGuardAuditThrottle();
    const log: SecurityAuditEntry[] = [];
    const limiter = new ApiRateLimiter({ capacity: 10, refillPerSecond: 10 });
    const deps = { env, security: { rateLimiter: limiter, audit: memoryAudit(log) } };
    const url = "http://localhost/api/v1/events";

    for (let i = 0; i < 5; i += 1) {
      guardRequest(new Request(url, { method: "POST", headers: { "x-api-key": READER_KEY } }), deps);
    }
    await settle();
    expect(log.filter((e) => e.action === "METHOD_NOT_ALLOWED")).toHaveLength(5);
    resetGuardAuditThrottle();
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
    "READINESS_ALLOWED_CIDRS",
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

/**
 * The edge sits in front of an app that already sends a route-aware security
 * header set, and Caddy's `header` directive REPLACES rather than merges. So
 * every header listed in both places is a chance for the edge to silently
 * weaken the app's policy — which is exactly what happened: a site-wide CSP
 * overwrote the API's `default-src 'none'; ...; sandbox`, and a shorter HSTS
 * max-age overwrote the app's. These assertions encode the rule that the edge
 * must never weaken what the app sends.
 */
describe("Caddy edge headers do not weaken the app's policy", () => {
  const caddyfile = readFileSync(
    resolve(import.meta.dirname, "..", "..", "..", "..", "infra", "Caddyfile"),
    "utf8",
  );

  /** Every `header` directive in the Caddyfile, with its optional matcher block. */
  function caddyHeaderDirectives(): { header: string; value: string; matcher: string }[] {
    const found: { header: string; value: string; matcher: string }[] = [];
    const lines = caddyfile.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = (lines[i] ?? "").trim();
      const single = line.match(/^header\s+(-?\S+)\s+"([^"]*)"\s*\{\s*$/);
      const inBlock = line.match(/^(-?[A-Za-z-]+)\s+"([^"]*)"\s*$/);
      if (single) {
        // Consume the matcher block that follows.
        const matcher: string[] = [];
        for (let j = i + 1; j < lines.length; j++) {
          const next = (lines[j] ?? "").trim();
          if (next === "}") break;
          matcher.push(next);
        }
        found.push({ header: single[1]!, value: single[2]!, matcher: matcher.join(" ") });
      } else if (inBlock) {
        found.push({ header: inBlock[1]!, value: inBlock[2]!, matcher: "" });
      }
    }
    return found;
  }

  it("scopes the CSP away from /api/* so the app's stricter API policy survives", () => {
    const cspDirectives = caddyHeaderDirectives().filter((d) => d.header === "Content-Security-Policy");
    expect(cspDirectives.length).toBeGreaterThan(0);

    for (const directive of cspDirectives) {
      // Without a matcher this is site-wide, which is the bug: the JSON API
      // would inherit `script-src 'unsafe-inline'` and lose its `sandbox`.
      expect(directive.matcher).not.toBe("");
      expect(directive.matcher).toContain("not path");
      // `/api` alone is matched too, so a bare `/api` cannot slip through.
      expect(directive.matcher).toMatch(/not path\s+\/api\s+\/api\/\*/);
    }
  });

  it("never sets the API CSP policy at the edge", () => {
    const cspValues = caddyHeaderDirectives()
      .filter((d) => d.header === "Content-Security-Policy")
      .map((d) => d.value);
    // If a future edit pastes the API policy into the Caddyfile it would have to
    // be scoped to /api/* at most; as a page policy it would be wrong.
    for (const value of cspValues) {
      expect(value).not.toContain("sandbox");
      expect(value).not.toContain("default-src 'none'");
    }
  });

  it("sends a page CSP identical to the app's, so the override is a no-op", () => {
    const edge = caddyHeaderDirectives().find((d) => d.header === "Content-Security-Policy");
    expect(edge?.value).toBe(pageContentSecurityPolicy());
  });

  it("does not weaken any header it duplicates from the app", () => {
    const edge = new Map(caddyHeaderDirectives().map((d) => [d.header, d.value]));
    const overTls = baseSecurityHeaders(true);

    for (const [name, appValue] of Object.entries(overTls)) {
      const edgeValue = edge.get(name);
      if (edgeValue === undefined) continue; // not duplicated: the app's value stands
      expect(edgeValue).toBe(appValue);
    }
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