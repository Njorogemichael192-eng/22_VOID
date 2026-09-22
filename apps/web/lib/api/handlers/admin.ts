/**
 * Admin endpoints (Phase 12): /api/v1/admin/sources and
 * /api/v1/admin/audit-logs.
 *
 * Both require the admin API key (role `admin`); the reader key gets 403.
 * Sources return per-source row counts for operational monitoring; audit logs
 * expose the §66 trail (who did what to which entity, with JSON detail).
 */

import { requireAuth } from "../auth";
import { jsonOk } from "../http";
import {
  auditLogListQuerySchema,
  invalidCursorResponse,
  parseQuery,
  resolveCursor,
  toAuditLogFilter,
} from "../schema";
import { pagination, type HandlerDeps } from "./common";

export async function listAdminSources(request: Request, deps: HandlerDeps): Promise<Response> {
  const auth = requireAuth(request, deps.env, "admin");
  if (auth instanceof Response) return auth;

  const sources = await deps.repo.listAdminSources();
  return jsonOk({ data: sources });
}

export async function listAuditLogs(request: Request, deps: HandlerDeps): Promise<Response> {
  const auth = requireAuth(request, deps.env, "admin");
  if (auth instanceof Response) return auth;

  const parsed = parseQuery(request, auditLogListQuerySchema);
  if (!parsed.ok) return parsed.response;

  const filter = toAuditLogFilter(parsed.query);
  const cursor = resolveCursor(parsed.query.cursor);
  if (cursor === "invalid") return invalidCursorResponse();
  filter.cursor = cursor;

  const page = await deps.repo.listAuditLogs(filter);
  return jsonOk({ data: page.data, pagination: pagination(filter.limit, page.nextCursor) });
}