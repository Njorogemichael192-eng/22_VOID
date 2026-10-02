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
 * Response precedence is unchanged by the Phase 18 audit work below: a wrong
 * method still answers 405 whether or not a key was supplied. What changed is
 * *who gets an audit row written for it*.
 *
 * `authenticate` is hoisted above the method and body checks so their audits can
 * be gated on the caller being authenticated. It is a pure key comparison with no
 * side effects, so evaluating it early cannot change any response. Previously an
 * unauthenticated POST to a GET-only route wrote one `auditLog.create` row per
 * request *before* any credential was checked, so a single unauthenticated flood
 * turned into a database write amplification DoS — bounded only by the token
 * bucket, whose key is the caller-supplied `x-forwarded-for` and therefore
 * trivially rotated. An unauthenticated request now writes at most a throttled
 * `AUTH_FAILED` row, and a wrong-method POST writes none at all.
 *
 * Rejections reachable without a valid key (`RATE_LIMITED`, `AUTH_FAILED`) audit
 * at most once per caller per `UNAUTHENTICATED_AUDIT_INTERVAL_MS`, because a
 * blocked or keyless caller generates them fastest and they are the rows an
 * attacker controls. Rejections that require a valid key (wrong method, bad body,
 * insufficient role) and successful admin access always audit.
 */

import { authenticate, type ApiAuthEnv, type ApiRole } from "../api/auth";
import { jsonError } from "../api/http";
import { nullAudit, type SecurityAudit } from "./audit";
import { ApiRateLimiter, clientIp } from "./rate-limit";

export const MAX_API_BODY_BYTES = 64 * 1024;

/**
 * Minimum gap between two audit rows for the same caller *and* action, applied
 * only to the rejection codes an unauthenticated caller can reach. Overridden by
 * SecurityDeps.auditThrottleMs (0 disables throttling) so tests can drive it
 * without sleeping; the default interval is real time, not a test artefact.
 */
export const UNAUTHENTICATED_AUDIT_INTERVAL_MS = 60_000;

/** Upper bound on tracked throttled callers, so the map cannot grow unbounded. */
const RATE_LIMITED_AUDIT_MAX_KEYS = 10_000;

const unauthenticatedAuditedAt = new Map<string, number>();

/** Test helper: forget every throttled caller. */
export function resetGuardAuditThrottle(): void {
  unauthenticatedAuditedAt.clear();
}

/**
 * True at most once per throttle window for a given (caller, action) pair.
 * `now` is passed in rather than read from the clock so callers driving a fake
 * clock in tests get the same behaviour they would get in production.
 */
function shouldAuditThrottled(ip: string, action: string, at: number, intervalMs: number): boolean {
  if (intervalMs <= 0) return true;
  const key = `${action}|${ip}`;
  const lastAuditedAt = unauthenticatedAuditedAt.get(key);
  if (lastAuditedAt !== undefined && at - lastAuditedAt < intervalMs) {
    return false;
  }
  if (unauthenticatedAuditedAt.size >= RATE_LIMITED_AUDIT_MAX_KEYS) {
    unauthenticatedAuditedAt.clear();
  }
  unauthenticatedAuditedAt.set(key, at);
  return true;
}

export interface SecurityDeps {
  rateLimiter?: ApiRateLimiter;
  audit?: SecurityAudit;
  /** Allowed HTTP methods for this endpoint. Defaults to GET only. */
  methods?: ReadonlyArray<string>;
  /** Accept a non-empty body up to this many bytes; default 64 KiB. */
  maxBodyBytes?: number;
  /**
   * Minimum gap between throttled unauthenticated-audits for one caller and
   * action. Defaults to UNAUTHENTICATED_AUDIT_INTERVAL_MS; 0 audits every one.
   */
  auditThrottleMs?: number;
  /** Clock override for deterministic tests. */
  now?: () => number;
}

export type GuardOk = { ok: true; role: ApiRole };
export type GuardResult = Response | GuardOk;

export function guardRequest(
  request: Request,
  deps: { env: ApiAuthEnv; security?: SecurityDeps },
  required: ApiRole = "reader"
): GuardResult {
  const security: SecurityDeps = deps.security ?? {};
  const audit = security.audit ?? nullAudit;
  const methods = security.methods ?? ["GET"];
  const maxBodyBytes = security.maxBodyBytes ?? MAX_API_BODY_BYTES;
  const now = security.now ?? (() => Date.now());
  const auditThrottleMs = security.auditThrottleMs ?? UNAUTHENTICATED_AUDIT_INTERVAL_MS;
  const ip = clientIp(request);
  const path = new URL(request.url).pathname;

  const limiter = security.rateLimiter ?? new ApiRateLimiter({ capacity: 120, refillPerSecond: 2 });
  const limit = limiter.consume(`ip:${ip}`);
  if (!limit.allowed) {
    const response = jsonError(
      "RATE_LIMITED",
      "Too many requests. Retry after the advertised interval.",
      429,
      { retryAfterMs: limit.retryAfterMs }
    );
    response.headers.set("retry-after", String(Math.ceil(limit.retryAfterMs / 1000)));
    if (shouldAuditThrottled(ip, "RATE_LIMITED", now(), auditThrottleMs)) {
      void audit.record({
        action: "RATE_LIMITED",
        actor: ip,
        detail: { path, retryAfterMs: limit.retryAfterMs },
      });
    }
    return response;
  }

  // Resolved before the method and body checks purely so their audits can be
  // gated on a valid key. Pure function, no side effects, and the responses below
  // are unchanged: an unauthenticated POST still gets 405, it just no longer
  // costs a database write.
  const role = authenticate(request, deps.env);
  const authenticated = role !== null;

  if (!methods.includes(request.method)) {
    const response = jsonError(
      "METHOD_NOT_ALLOWED",
      `This endpoint only supports ${methods.join(", ")}.`,
      405
    );
    response.headers.set("allow", methods.join(", "));
    if (authenticated) {
      void audit.record({
        action: "METHOD_NOT_ALLOWED",
        actor: ip,
        detail: { method: request.method, path },
      });
    }
    return response;
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 0) {
    if (contentLength > maxBodyBytes) {
      const response = jsonError(
        "PAYLOAD_TOO_LARGE",
        `Request body exceeds the ${maxBodyBytes} byte limit.`,
        413
      );
      // Same gate as the method check: an unauthenticated flood must not be able
      // to reach the audit port by sending a body instead of relying on 405.
      if (authenticated) {
        void audit.record({
          action: "PAYLOAD_TOO_LARGE",
          actor: ip,
          detail: { bytes: contentLength, limit: maxBodyBytes },
        });
      }
      return response;
    }
    const response = jsonError(
      "REQUEST_BODY_NOT_ALLOWED",
      "The API is read-only; requests must not carry a body.",
      400
    );
    if (authenticated) {
      void audit.record({ action: "REQUEST_BODY_NOT_ALLOWED", actor: ip });
    }
    return response;
  }

  if (!authenticated) {
    const keyPresent = request.headers.get("x-api-key") !== null;
    const response = jsonError(
      "UNAUTHORIZED",
      'Missing or invalid API key. Send it in the "x-api-key" header.',
      401
    );
    if (shouldAuditThrottled(ip, "AUTH_FAILED", now(), auditThrottleMs)) {
      void audit.record({
        action: "AUTH_FAILED",
        actor: ip,
        detail: {
          keyPresent,
          path,
          reason: "no valid role for supplied key",
        },
      });
    }
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
