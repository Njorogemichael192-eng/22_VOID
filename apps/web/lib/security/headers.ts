/**
 * Apps/web security headers (Phase 16).
 *
 * A single, deterministic header policy shared by the Next 16 proxy
 * (apps/web/proxy.ts) and any test that asserts HTTP responses carry the
 * security posture. Keeping the values here (not in next.config.ts) means the
 * proxy — which wraps Page and Route Handler responses — is the single source
 * of truth for security headers.
 *
 * Page CSP follows the Next.js documented approach for server-rendered App
 * Router apps (inline bootstrap scripts/styles are required by Next's runtime),
 * so `script-src`/`style-src` allow the inline integrity tokens Next needs. The
 * API CSP is stricter: a JSON API never executes scripts. A nonce-based page
 * CSP is a Phase 20 refinement.
 */

export interface SecurityHeaderSet {
  [name: string]: string;
}

/** Headers that every response should carry regardless of route. */
export function baseSecurityHeaders(overTls: boolean): SecurityHeaderSet {
  const headers: SecurityHeaderSet = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
  if (overTls) {
    headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains";
  }
  return headers;
}

/**
 * Content-Security-Policy for HTML documents. `'unsafe-inline'` on script-src
 * is the documented Next.js trade-off (SSR inline bootstrap); it does not open
 * cross-origin exfiltration because default-src/object-src/base-uri/connect-src
 * stay locked down. Style-src inline is required by Next's critical CSS.
 */
export function pageContentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** Content-Security-Policy for the JSON API surface: nothing runs client-side. */
export function apiContentSecurityPolicy(): string {
  return "default-src 'none'; frame-ancestors 'none'; sandbox";
}

export function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/");
}