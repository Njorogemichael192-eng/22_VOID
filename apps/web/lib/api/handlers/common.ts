/**
 * Shared pieces for Phase 12 handlers: the per-request dependency bundle and
 * the pagination envelope.
 */

import { encodeCursor, type ApiRepo, type Cursor } from "@22void/db";
import type { ApiAuthEnv } from "../auth";

export interface HandlerDeps {
  repo: ApiRepo;
  env: ApiAuthEnv;
  /** Injectable clock for deterministic staleness tests. */
  now?: () => number;
}

export interface Pagination {
  limit: number;
  nextCursor: string | null;
}

export function pagination(limit: number, cursor: Cursor | null): Pagination {
  return { limit, nextCursor: cursor ? encodeCursor(cursor) : null };
}