/**
 * Server-side environment for the Phase 12 HTTP API.
 *
 * Keys are read from the environment so nothing secret is ever shipped to the
 * client bundle (route handlers are server-only). `apps/web/.env.example`
 * documents the variables. When neither key is configured the API answers 401
 * for every protected endpoint — fail closed, never fail open.
 */

export interface ApiAuthEnv {
  apiKey?: string;
  adminApiKey?: string;
}

export function serverApiEnv(): ApiAuthEnv {
  return {
    apiKey: process.env.API_KEY || undefined,
    adminApiKey: process.env.ADMIN_API_KEY || undefined,
  };
}