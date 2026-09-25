/**
 * Apps/web API request guard (Phase 16, hardened in Phase 18).
 *
 * One entry point for every protected HTTP API handler, replacing the bare
 * `requireAuth` call. Layered checks:
 *
 *   1. rate limit — per-caller token bucket (429 + Retry-After);
 *   2. method — these endpoints are GET-only (405 + Allow header);
 *   3. body — a read API never accepts a payload (400/413);
 *   4. authorization — reader/admin API keys via the Phase 12 auth envelope.
 *
 * Rate limiting runs first on purpose. Every rejection below it writes an audit
 * row, so checking it afterwards let an unauthenticated flood (for example a
 * stream of POSTs) turn one cheap rejection into one database write per
 * request. With the limiter first, sustained flood traffic is answered from
 * memory and never reaches the audit port.
 *
 * Rejections that are not rate-limit rejections still audit unconditionally, but
 * 429s are additionally throttled to at most one row per caller per
 * RATE_LIMITED_AUDIT_INTERVAL_MS, since a blocked caller generates them fastest.
 */

import { authenticate, type ApiAuthEnv, type ApiRole } from "../api/auth";
import { jsonError } from "../api/http";
import { nullAudit, type SecurityAudit } from "./audit";
import { ApiRateLimiter, clientIp } from "./rate-limit";

export const MAX_API_BODY_BYTES = 64 * 1024;

/** Minimum gap between two RATE_LIMITED audit rows for the same caller. */
export const RATE_LIMITED_AUDIT_INTERVAL_MS = 60_000;

/** Upper bound on tracked throttled callers, so the map cannot grow unbounded. */
const RATE_LIMITED_AUDIT_MAX_KEYS = 10_000;

const rateLimitedAuditedAt = new Map<string, number>();

/** Test helper: forget every throttled caller. */
export function resetGuardAuditThrottle(): void {
  rateLimitedAuditedAt.clear();
}

function shouldAuditRateLimited(ip: string, at: number): boolean {
  const lastAuditedAt = rateLimitedAuditedAt.get(ip);
  if (lastAuditedAt !== undefined && at - lastAuditedAt < RATE_LIMITED_AUDIT_INTERVAL_MS) {
    return false;
  }
  if (rateLimitedAuditedAt.size >= RATE_LIMITED_AUDIT_MAX_KEYS) rateLimitedAuditedAt.clear();
  rateLimitedAuditedAt.set(ip, at);
  return true;
}

export interface SecurityDeps {
  rateLimiter?: ApiRateLimiter;
  audit?: SecurityAudit;
  /** Allowed HTTP methods for this endpoint. Defaults to GET only. */
  methods?: ReadonlyArray<string>;
  /** Accept a non-empty body up to this many bytes; default 64 KiB. */
  maxBodyBytes?: number;
  /** Clock override for deterministic tests. */
  now?: () => number;
}

export type GuardOk = { ok: true; role: ApiRole };
export type GuardResult = Response | GuardOk;

export function guardRequest(
  request: Request,
  deps: { env: ApiAuthEnv; security?: SecurityDeps },
  required: ApiRole = "reader",
): GuardResult {
  const security: SecurityDeps = deps.security ?? {};
  const audit = security.audit ?? nullAudit;
  const methods = security.methods ?? ["GET"];
  const maxBodyBytes = security.maxBodyBytes ?? MAX_API_BODY_BYTES;
  const now = security.now ?? (() => Date.now());
  const ip = clientIp(request);
  const path = new URL(request.url).pathname;

  const limiter =
    security.rateLimiter ??
    new ApiRateLimiter({ capacity: 120, refillPerSecond: 2 });
  const limit = limiter.consume(`ip:${ip}`);
  if (!limit.allowed) {
    const response = jsonError(
      "RATE_LIMITED",
      "Too many requests. Retry after the advertised interval.",
      429,
      { retryAfterMs: limit.retryAfterMs },
    );
    response.headers.set("retry-after", String(Math.ceil(limit.retryAfterMs / 1000)));
    if (shouldAuditRateLimited(ip, now())) {
      void audit.record({
        action: "RATE_LIMITED",
        actor: ip,
        detail: { path, retryAfterMs: limit.retryAfterMs },
      });
    }
    return response;
  }

  if (!methods.includes(request.method)) {
    const response = jsonError(
      "METHOD_NOT_ALLOWED",
      `This endpoint only supports ${methods.join(", ")}.`,
      405,
    );
    response.headers.set("allow", methods.join(", "));
    void audit.record({
      action: "METHOD_NOT_ALLOWED",
      actor: ip,
      detail: { method: request.method, path },
    });
    return response;
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 0) {
    if (contentLength > maxBodyBytes) {
      const response = jsonError(
        "PAYLOAD_TOO_LARGE",
        `Request body exceeds the ${maxBodyBytes} byte limit.`,
        413,
      );
      void audit.record({
        action: "PAYLOAD_TOO_LARGE",
        actor: ip,
        detail: { bytes: contentLength, limit: maxBodyBytes },
      });
      return response;
    }
    const response = jsonError(
      "REQUEST_BODY_NOT_ALLOWED",
      "The API is read-only; requests must not carry a body.",
      400,
    );
    void audit.record({ action: "REQUEST_BODY_NOT_ALLOWED", actor: ip });
    return response;
  }

  const role = authenticate(request, deps.env);
  if (role === null) {
    const keyPresent = request.headers.get("x-api-key") !== null;
    const response = jsonError(
      "UNAUTHORIZED",
      "Missing or invalid API key. Send it in the \"x-api-key\" header.",
      401,
    );
    void audit.record({
      action: "AUTH_FAILED",
      actor: ip,
      detail: {
        keyPresent,
        path,
        reason: "no valid role for supplied key",
      },
    });
    return response;
  }

  if (required === "admin" && role !== "admin") {
    const response = jsonError("FORBIDDEN", "An admin API key is required for this endpoint.", 403);
    void audit.record({
      action: "AUTH_FORBIDDEN",
      actor: ip,
      detail: { role, path },
    });
    return response;
  }

  if (role === "admin") {
    void audit.record({
      action: "ADMIN_ACCESS",
      actor: ip,
      detail: { role, method: request.method, path },
    });
  }

  return { ok: true, role };
}