/**
 * Event endpoints (Phase 12): GET /api/v1/events and /api/v1/events/:id.
 *
 * Lists support pagination plus status / competition / team / start-window
 * filters; the detail view includes each source's event id link so callers can
 * trace cross-source reconciliation (spec §4.1, §6).
 */

import { requireAuth } from "../auth";
import { jsonError, jsonOk } from "../http";
import {
  eventListQuerySchema,
  idSchema,
  invalidCursorResponse,
  parseQuery,
  resolveCursor,
  toEventFilter,
} from "../schema";
import { pagination, type HandlerDeps } from "./common";

export async function listEvents(request: Request, deps: HandlerDeps): Promise<Response> {
  const auth = requireAuth(request, deps.env);
  if (auth instanceof Response) return auth;

  const parsed = parseQuery(request, eventListQuerySchema);
  if (!parsed.ok) return parsed.response;

  const filter = toEventFilter(parsed.query);
  const cursor = resolveCursor(parsed.query.cursor);
  if (cursor === "invalid") return invalidCursorResponse();
  filter.cursor = cursor;

  const page = await deps.repo.listEvents(filter);
  return jsonOk({ data: page.data, pagination: pagination(filter.limit, page.nextCursor) });
}

export async function getEvent(
  request: Request,
  deps: HandlerDeps,
  idParam: string,
): Promise<Response> {
  const auth = requireAuth(request, deps.env);
  if (auth instanceof Response) return auth;

  if (!idSchema.safeParse(idParam).success) {
    return jsonError("BAD_REQUEST", `Invalid event id "${idParam}".`, 400);
  }
  const event = await deps.repo.getEvent(idParam);
  if (!event) return jsonError("NOT_FOUND", `Event ${idParam} not found.`, 404);
  return jsonOk({ data: event });
}