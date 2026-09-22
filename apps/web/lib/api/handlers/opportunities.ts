/**
 * Opportunity endpoints (Phase 12): GET /api/v1/opportunities and
 * /api/v1/opportunities/:id.
 *
 * Lists filter on lifecycle status (spec §40) and event; the detail view
 * returns the full leg breakdown, stake/return mathematics and the engine +
 * Phase 11 validation evidence needed to reconstruct the decision. Statuses on
 * wire are the canonical domain values (DETECTED..REJECTED) and never include
 * a candidate that failed validation as verified.
 */

import { requireAuth } from "../auth";
import { jsonError, jsonOk } from "../http";
import {
  idSchema,
  invalidCursorResponse,
  opportunityListQuerySchema,
  parseQuery,
  resolveCursor,
  toOpportunityFilter,
} from "../schema";
import { pagination, type HandlerDeps } from "./common";

export async function listOpportunities(request: Request, deps: HandlerDeps): Promise<Response> {
  const auth = requireAuth(request, deps.env);
  if (auth instanceof Response) return auth;

  const parsed = parseQuery(request, opportunityListQuerySchema);
  if (!parsed.ok) return parsed.response;

  const filter = toOpportunityFilter(parsed.query);
  const cursor = resolveCursor(parsed.query.cursor);
  if (cursor === "invalid") return invalidCursorResponse();
  filter.cursor = cursor;

  const page = await deps.repo.listOpportunities(filter);
  return jsonOk({ data: page.data, pagination: pagination(filter.limit, page.nextCursor) });
}

export async function getOpportunity(
  request: Request,
  deps: HandlerDeps,
  idParam: string,
): Promise<Response> {
  const auth = requireAuth(request, deps.env);
  if (auth instanceof Response) return auth;

  if (!idSchema.safeParse(idParam).success) {
    return jsonError("BAD_REQUEST", `Invalid opportunity id "${idParam}".`, 400);
  }
  const opportunity = await deps.repo.getOpportunity(idParam);
  if (!opportunity) {
    return jsonError("NOT_FOUND", `Opportunity ${idParam} not found.`, 404);
  }
  return jsonOk({ data: opportunity });
}