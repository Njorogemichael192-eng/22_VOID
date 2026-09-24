/**
 * Apps/web API request guard (Phase 16).
 *
 * One entry point for every protected HTTP API handler, replacing the bare
 * `requireAuth` call. Layered checks, cheapest first:
 *
 *   1. method — these endpoints are GET-only (405 + Allow header);
 *   2. body — a read API never accepts a payload (400/413);
 *   3. rate limit — per-caller token bucket (429 + Retry-After);
 *   4. authorization — reader/admin API keys via the Phase 12 auth envelope.
 *
 * Each rejection and every successful admin operation is written to the
 * security audit port (best-effort, never awaited), so the §66 trail stays
 * reconstructable without changing the response status.
 */

import { authenticate, type ApiAuthEnv, type ApiRole } from "../api/auth";
import { jsonError } from "../api/http";
import { nullAudit, type SecurityAudit } from "./audit";
import { ApiRateLimiter, clientIp } from "./rate-limit";

export const MAX_API_BODY_BYTES = 64 * 1024;

export interface SecurityDeps {
  rateLimiter?: ApiRateLimiter;
  audit?: SecurityAudit;
  /** Allowed HTTP methods for this endpoint. Defaults to GET only. */
  methods?: ReadonlyArray<string>;
  /** Accept a non-empty body up to this many bytes; default 64 KiB. */
  maxBodyBytes?: number;
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
  const ip = clientIp(request);

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
      detail: { method: request.method, path: new URL(request.url).pathname },
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
    void audit.record({
      action: "RATE_LIMITED",
      actor: ip,
      detail: { path: new URL(request.url).pathname, retryAfterMs: limit.retryAfterMs },
    });
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
        path: new URL(request.url).pathname,
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
      detail: { role, path: new URL(request.url).pathname },
    });
    return response;
  }

  if (role === "admin") {
    void audit.record({
      action: "ADMIN_ACCESS",
      actor: ip,
      detail: { role, method: request.method, path: new URL(request.url).pathname },
    });
  }

  return { ok: true, role };
}