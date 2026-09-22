/**
 * Keyset pagination cursor for the HTTP API (Phase 12).
 *
 * Cursors are opaque, URL-safe strings (`22v.<base64url(JSON)>`) encoding the
 * ordering key of the last returned row. The API returns the cursor on the
 * first page and the client echoes it back for the next page; ordering-key
 * pagination stays stable even when rows are inserted between requests.
 *
 * The envelope carries:
 * - `v`  the ordering-key value of the boundary row (ISO timestamp or id)
 * - `d`  ordering direction of the list: 1 = ascending, -1 = descending
 * - `id` the boundary row id (unique tiebreaker)
 */

export type CursorDirection = 1 | -1;

export interface Cursor {
  value: string;
  direction: CursorDirection;
  id: string;
}

const PREFIX = "22v.";

/** Serialize a cursor to its opaque URL-safe form. */
export function encodeCursor(cursor: Cursor): string {
  const payload = JSON.stringify({
    v: cursor.value,
    d: cursor.direction,
    id: cursor.id,
  });
  return `${PREFIX}${Buffer.from(payload, "utf8").toString("base64url")}`;
}

/**
 * Parse an opaque cursor. Returns `null` when the value is malformed so callers
 * can answer `400 BAD_REQUEST` instead of guessing.
 */
export function decodeCursor(encoded: string): Cursor | null {
  if (!encoded.startsWith(PREFIX)) {
    return null;
  }
  const raw = encoded.slice(PREFIX.length);
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const payload = parsed as Record<string, unknown>;
  if (
    typeof payload.v !== "string" ||
    (payload.d !== 1 && payload.d !== -1) ||
    typeof payload.id !== "string"
  ) {
    return null;
  }
  return { value: payload.v, direction: payload.d, id: payload.id };
}