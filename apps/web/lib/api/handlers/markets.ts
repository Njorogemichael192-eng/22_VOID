/**
 * Market and odds endpoints (Phase 12): /api/v1/markets, /api/v1/markets/:id
 * and /api/v1/odds.
 *
 * A market detail carries its current odds (one row per bookmaker selection);
 * the odds list is the flat, queryable price view (eventId / marketId /
 * bookmaker filters). Markets are per-source identities; cross-source grouping
 * happens at scan time (spec §4.2).
 */

import { guardRequest } from "../../security/guard";
import { jsonError, jsonOk } from "../http";
import {
  idSchema,
  invalidCursorResponse,
  marketListQuerySchema,
  oddsListQuerySchema,
  parseQuery,
  resolveCursor,
  toMarketFilter,
  toOddsFilter,
} from "../schema";
import { pagination, type HandlerDeps } from "./common";

async function authorize(
  request: Request,
  deps: HandlerDeps,
  required: "reader" | "admin" = "reader",
) {
  return guardRequest(request, deps, required);
}

export async function listMarkets(request: Request, deps: HandlerDeps): Promise<Response> {
  const auth = await authorize(request, deps);
  if (auth instanceof Response) return auth;

  const parsed = parseQuery(request, marketListQuerySchema);
  if (!parsed.ok) return parsed.response;

  const filter = toMarketFilter(parsed.query);
  const cursor = resolveCursor(parsed.query.cursor);
  if (cursor === "invalid") return invalidCursorResponse();
  filter.cursor = cursor;

  const page = await deps.repo.listMarkets(filter);
  return jsonOk({ data: page.data, pagination: pagination(filter.limit, page.nextCursor) });
}

export async function getMarket(
  request: Request,
  deps: HandlerDeps,
  idParam: string,
): Promise<Response> {
  const auth = await authorize(request, deps);
  if (auth instanceof Response) return auth;

  if (!idSchema.safeParse(idParam).success) {
    return jsonError("BAD_REQUEST", `Invalid market id "${idParam}".`, 400);
  }
  const market = await deps.repo.getMarket(idParam);
  if (!market) return jsonError("NOT_FOUND", `Market ${idParam} not found.`, 404);
  return jsonOk({ data: market });
}

export async function listOdds(request: Request, deps: HandlerDeps): Promise<Response> {
  const auth = await authorize(request, deps);
  if (auth instanceof Response) return auth;

  const parsed = parseQuery(request, oddsListQuerySchema);
  if (!parsed.ok) return parsed.response;

  const filter = toOddsFilter(parsed.query);
  const cursor = resolveCursor(parsed.query.cursor);
  if (cursor === "invalid") return invalidCursorResponse();
  filter.cursor = cursor;

  const page = await deps.repo.listOdds(filter);
  return jsonOk({ data: page.data, pagination: pagination(filter.limit, page.nextCursor) });
}