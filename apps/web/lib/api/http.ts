/**
 * Minimal JSON response helpers for the Phase 12 HTTP API.
 *
 * Error bodies follow the spec's envelope: `{ "error": { "code", "message",
 * "detail?" } }`. `code` is a stable machine-readable token; `status` is the
 * HTTP status code.
 */

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    detail?: unknown;
  };
}

export function jsonOk(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    status: init.status ?? 200,
    headers: { "content-type": "application/json; charset=utf-8", ...init.headers },
  });
}

export function jsonError(
  code: string,
  message: string,
  status: number,
  detail?: unknown,
): Response {
  const body: ApiErrorBody = detail === undefined ? { error: { code, message } } : { error: { code, message, detail } };
  return jsonOk(body, { status });
}

export function badRequest(message = "Invalid query parameters.", detail?: unknown): Response {
  return jsonError("BAD_REQUEST", message, 400, detail);
}