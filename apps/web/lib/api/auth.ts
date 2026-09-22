/**
 * API-key authentication for the Phase 12 HTTP API (docs/ARCHITECTURE.md).
 *
 * The reader key (`x-api-key: <API_KEY>`) grants read access to the public
 * endpoints; the admin key (`x-api-key: <ADMIN_API_KEY>`) also unlocks the
 * /admin/* endpoints. Phase 16 replaces this with full auth/authorization, but
 * the envelope (401 / 403 + typed error codes) stays stable.
 */

import { timingSafeEqual } from "node:crypto";
import { jsonError } from "./http";

export const API_KEY_HEADER = "x-api-key";
export const API_KEY_HEADER_DESCRIPTION = "API key identifying the caller";

export type ApiRole = "reader" | "admin";

export interface ApiAuthEnv {
  apiKey?: string;
  adminApiKey?: string;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Resolve the caller's role from the request, or null when the request is not
 * authenticated. The admin key is checked first so a valid admin key can never
 * be mistaken for a reader key.
 */
export function authenticate(request: Request, env: ApiAuthEnv): ApiRole | null {
  const key = request.headers.get(API_KEY_HEADER);
  if (!key) return null;
  if (env.adminApiKey && safeEqual(key, env.adminApiKey)) return "admin";
  if (env.apiKey && safeEqual(key, env.apiKey)) return "reader";
  return null;
}

export type AuthOk = { ok: true; role: ApiRole };

/**
 * Guard used by every protected handler. Returns `{ ok: true, role }` or an
 * error Response (401 when unauthenticated, 403 when the role is insufficient).
 */
export function requireAuth(
  request: Request,
  env: ApiAuthEnv,
  required: ApiRole = "reader",
): Response | AuthOk {
  const role = authenticate(request, env);
  if (!role) {
    return jsonError(
      "UNAUTHORIZED",
      `Missing or invalid API key. Send it in the "${API_KEY_HEADER}" header.`,
      401,
    );
  }
  if (required === "admin" && role !== "admin") {
    return jsonError("FORBIDDEN", "An admin API key is required for this endpoint.", 403);
  }
  return { ok: true, role };
}