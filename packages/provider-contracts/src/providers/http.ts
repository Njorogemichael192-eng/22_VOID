/**
 * Minimal fetch-with-timeout helper used by live provider adapters.
 * Network reachability vs HTTP errors are kept distinct so the scanner can
 * record PROVIDER_UNAVAILABLE vs PROVIDER_ERROR (§71).
 */

export class ProviderTransportError extends Error {
  readonly status: number | undefined;
  constructor(message: string, options: { status?: number } = {}) {
    super(message);
    this.name = "ProviderTransportError";
    this.status = options.status;
  }
}

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Strip the query string from every URL in a string destined for a log or error.
 *
 * This replaced a denylist that removed a single hardcoded `?apiKey=` parameter.
 * A denylist is the wrong shape for this problem: it only protects the exact
 * parameter name someone remembered, so `apikey=`, `api_key=`, `token=` and any
 * future credential-in-URL all passed straight through, and a provider that
 * spells its parameter differently leaked silently. Query strings have no
 * business in an error message, so the entire search component is dropped and
 * only scheme, host and path survive.
 *
 * Deliberately regex-based rather than `new URL()`: this runs on message text
 * that may contain a bare URL mid-sentence, and `new URL` throws on those.
 */
export function redactUrlForDisplay(text: string): string {
  return text.replace(
    /([a-z][a-z0-9+.-]*:\/\/[^\s?#]*)\?[^\s"']*/gi,
    (_match, authorityAndPath: string) => authorityAndPath
  );
}

export async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new ProviderTransportError(`HTTP ${response.status} for ${redactUrlForDisplay(url)}`, {
        status: response.status,
      });
    }
    return (await response.json()) as unknown;
  } catch (error) {
    if (error instanceof ProviderTransportError) throw error;
    const cause = error instanceof Error ? error.message : String(error);
    // The message, not just the URL argument, is a leak surface: a fetch that
    // fails to parse its input embeds the offending URL in the TypeError, and
    // that text propagates to `console.error` in the worker's cycle handler.
    throw new ProviderTransportError(`network error: ${redactUrlForDisplay(cause)}`);
  } finally {
    clearTimeout(timer);
  }
}
