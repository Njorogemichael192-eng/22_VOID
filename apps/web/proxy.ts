/**
 * apps/web/proxy.ts
 *
 * Next 16 proxy (the renamed middleware surface). Runs before Page and Route
 * Handler responses and applies the Phase 16 security-header policy from
 * ./lib/security/headers.ts. HSTS is only attached when the request actually
 * arrived over TLS (browsers ignore it over plain http anyway — this just keeps
 * the local dev response set clean).
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  apiContentSecurityPolicy,
  baseSecurityHeaders,
  isApiPath,
  pageContentSecurityPolicy,
} from "./lib/security/headers";

export default function proxy(request: NextRequest): NextResponse {
  const overTls = request.nextUrl.protocol === "https:";
  const headers = baseSecurityHeaders(overTls);
  headers["Content-Security-Policy"] = isApiPath(request.nextUrl.pathname)
    ? apiContentSecurityPolicy()
    : pageContentSecurityPolicy();

  const response = NextResponse.next({ request });
  for (const [name, value] of Object.entries(headers)) {
    response.headers.set(name, value);
  }
  return response;
}