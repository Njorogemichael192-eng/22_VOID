/**
 * Query-string parsing for the Phase 12 HTTP API (zod v4).
 *
 * Every list endpoint accepts `limit` (1..100, default 50) and an opaque
 * `cursor`. Handlers translate the parsed query into the repository filter in
 * ./types filtering; the cursor envelope is decoded with @22void/db's cursor
 * codec. Enum filters are validated against the canonical domain value sets so
 * malformed values fail fast with 400 instead of 500.
 */

import { z } from "zod";
import {
  decodeCursor,
  type Cursor,
  type EventFilter,
  type MarketFilter,
  type OddsFilter,
  type OpportunityFilter,
  type AuditLogFilter,
} from "@22void/db";
import {
  EVENT_STATUS_VALUES,
  MARKET_FAMILY_VALUES,
  OPPORTUNITY_STATUS_VALUES,
  PERIOD_VALUES,
} from "@22void/domain";
import { badRequest } from "./http";

export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 100;

export const limitSchema = z.coerce.number().int().min(1).max(MAX_LIST_LIMIT);
export const cursorSchema = z.string().min(1);
export const idSchema = z.string().min(1).max(64);

const isoDateTimeSchema = z.iso.datetime({ offset: true });

// ---------------------------------------------------------------------------
// Query schemas
// ---------------------------------------------------------------------------

export const eventListQuerySchema = z.object({
  limit: limitSchema.optional(),
  cursor: cursorSchema.optional(),
  status: z.enum(EVENT_STATUS_VALUES).optional(),
  competition: z.string().optional(),
  team: z.string().optional(),
  startFrom: isoDateTimeSchema.optional(),
  startTo: isoDateTimeSchema.optional(),
});
export type EventListQuery = z.infer<typeof eventListQuerySchema>;

export const marketListQuerySchema = z.object({
  limit: limitSchema.optional(),
  cursor: cursorSchema.optional(),
  eventId: idSchema.optional(),
  family: z.enum(MARKET_FAMILY_VALUES).optional(),
  period: z.enum(PERIOD_VALUES).optional(),
});
export type MarketListQuery = z.infer<typeof marketListQuerySchema>;

export const oddsListQuerySchema = z.object({
  limit: limitSchema.optional(),
  cursor: cursorSchema.optional(),
  marketId: idSchema.optional(),
  eventId: idSchema.optional(),
  bookmaker: z.string().optional(),
});
export type OddsListQuery = z.infer<typeof oddsListQuerySchema>;

export const opportunityListQuerySchema = z.object({
  limit: limitSchema.optional(),
  cursor: cursorSchema.optional(),
  status: z.enum(OPPORTUNITY_STATUS_VALUES).optional(),
  eventId: idSchema.optional(),
});
export type OpportunityListQuery = z.infer<typeof opportunityListQuerySchema>;

export const auditLogListQuerySchema = z.object({
  limit: limitSchema.optional(),
  cursor: cursorSchema.optional(),
  entityType: z.string().optional(),
});
export type AuditLogListQuery = z.infer<typeof auditLogListQuerySchema>;

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

export type QueryResult<T> = { ok: true; query: T } | { ok: false; response: Response };

/**
 * Parse `req`'s search parameters against `schema`. On failure responds 400
 * with the zod issue list as `detail`.
 */
export function parseQuery<T>(req: Request, schema: z.ZodType<T>): QueryResult<T> {
  const url = new URL(req.url);
  const params = Object.fromEntries(url.searchParams.entries());
  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({
          error: {
            code: "BAD_REQUEST",
            message: "Invalid query parameters.",
            detail: parsed.error.issues,
          },
        }),
        {
          status: 400,
          headers: { "content-type": "application/json; charset=utf-8" },
        },
      ),
    };
  }
  return { ok: true, query: parsed.data };
}

/** Resolve an opaque cursor param; returns "invalid" to trigger a 400. */
export function resolveCursor(value: string | undefined): Cursor | null | "invalid" {
  if (value === undefined) return null;
  return decodeCursor(value) ?? "invalid";
}

/** 400 response for a malformed cursor param. */
export function invalidCursorResponse(): Response {
  return badRequest(
    "Invalid cursor.",
    "Supply a cursor previously returned by this endpoint's pagination block.",
  );
}

export function toEventFilter(query: EventListQuery): EventFilter {
  return {
    status: query.status,
    competition: query.competition,
    team: query.team,
    startFrom: query.startFrom,
    startTo: query.startTo,
    cursor: null,
    limit: query.limit ?? DEFAULT_LIST_LIMIT,
  };
}

export function toMarketFilter(query: MarketListQuery): MarketFilter {
  return {
    eventId: query.eventId,
    family: query.family,
    period: query.period,
    cursor: null,
    limit: query.limit ?? DEFAULT_LIST_LIMIT,
  };
}

export function toOddsFilter(query: OddsListQuery): OddsFilter {
  return {
    marketId: query.marketId,
    eventId: query.eventId,
    bookmaker: query.bookmaker,
    cursor: null,
    limit: query.limit ?? DEFAULT_LIST_LIMIT,
  };
}

export function toOpportunityFilter(query: OpportunityListQuery): OpportunityFilter {
  return {
    status: query.status,
    eventId: query.eventId,
    cursor: null,
    limit: query.limit ?? DEFAULT_LIST_LIMIT,
  };
}

export function toAuditLogFilter(query: AuditLogListQuery): AuditLogFilter {
  return {
    entityType: query.entityType,
    cursor: null,
    limit: query.limit ?? DEFAULT_LIST_LIMIT,
  };
}