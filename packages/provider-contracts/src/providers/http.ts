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
      throw new ProviderTransportError(
        `HTTP ${response.status} for ${url.replace(/[?&]apiKey=[^&]+/g, "")}`,
        { status: response.status }
      );
    }
    return (await response.json()) as unknown;
  } catch (error) {
    if (error instanceof ProviderTransportError) throw error;
    const cause = error instanceof Error ? error.message : String(error);
    throw new ProviderTransportError(`network error: ${cause}`);
  } finally {
    clearTimeout(timer);
  }
}
