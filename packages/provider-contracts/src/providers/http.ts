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

/**
 * Credit/quota accounting a provider reports on every response.
 *
 * The Odds API returns `x-requests-remaining`, `x-requests-used` and
 * `x-requests-last` on every call. Until now `fetchJson` discarded them, so the
 * only way to learn the remaining balance was to go and read the provider's web
 * dashboard - which means burning quota while unable to tell how much is left,
 * and discovering an exhausted quota only as an unexplained 401.
 *
 * `last` is the cost of the most recent call, which is the number that makes a
 * silent quota regression visible: a poll costing 8 instead of the expected 4
 * shows up here immediately even though nothing failed.
 */
export interface ProviderQuota {
  /** Credits remaining until the provider's quota resets. */
  readonly remaining: number | undefined;
  /** Credits used since the last quota reset. */
  readonly used: number | undefined;
  /** Credit cost of the most recent call. */
  readonly last: number | undefined;
}

export interface ProviderResponseMeta {
  readonly status: number;
  /** Absent when the provider does not report quota headers. */
  readonly quota?: ProviderQuota;
}

type HeaderReader = { get(name: string): string | null };

/**
 * Read a quota header as a non-negative integer.
 *
 * A missing header and a malformed one are both `undefined` rather than a guess:
 * the provider documents these as optional per endpoint, and reporting a
 * fabricated 0 for "not reported" would turn a missing header into an
 * "out of quota" alarm. Non-integer or negative values are ignored for the same
 * reason - a quota display must not be able to lie about exhaustion.
 */
function quotaHeader(headers: HeaderReader, name: string): number | undefined {
  const raw = headers.get(name);
  if (raw === null) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) return undefined;
  return value;
}

/** Assemble the quota triple, or undefined when the provider reported nothing. */
export function readProviderQuota(
  headers: HeaderReader | null | undefined
): ProviderQuota | undefined {
  // Defensive on purpose: quota reporting is observability, and observability
  // must never become a failure mode. A response with no readable headers yields
  // "unreported" rather than throwing, so the worst case of adding this is a
  // missing number in a log line - never a failed poll.
  if (headers === undefined || headers === null) return undefined;
  if (typeof headers.get !== "function") return undefined;
  const remaining = quotaHeader(headers, "x-requests-remaining");
  const used = quotaHeader(headers, "x-requests-used");
  const last = quotaHeader(headers, "x-requests-last");
  if (remaining === undefined && used === undefined && last === undefined) return undefined;
  return { remaining, used, last };
}

/** Single-line rendering for the worker's per-cycle log. Null when unreported. */
export function formatProviderQuota(quota: ProviderQuota | null | undefined): string {
  if (quota === undefined || quota === null) return "unreported";
  const part = (value: number | undefined): string => (value === undefined ? "?" : String(value));
  return `remaining=${part(quota.remaining)} used=${part(quota.used)} last=${part(quota.last)}`;
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
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  onMeta?: (meta: ProviderResponseMeta) => void
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    // Reported before the ok check, deliberately. The most valuable moment to see
    // the quota is when a request FAILS: a 401 on an exhausted plan and a 401 on
    // a bad key look identical from the outside, and only `remaining=0`
    // distinguishes them. Observing on the error path too is what makes that
    // diagnosable without leaving the machine.
    const quota = readProviderQuota(response.headers);
    if (onMeta !== undefined) onMeta({ status: response.status, ...(quota ? { quota } : {}) });
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
