import { describe, expect, it } from "vitest";

import { fetchJson, ProviderTransportError, redactUrlForDisplay } from "./http";

describe("redactUrlForDisplay", () => {
  it("drops the entire query string", () => {
    expect(redactUrlForDisplay("https://api.example.com/v4/sports?apiKey=secret&regions=uk")).toBe(
      "https://api.example.com/v4/sports"
    );
  });

  it("drops query strings regardless of the parameter name", () => {
    // The old implementation removed a single hardcoded `?apiKey=` parameter, so
    // every other credential spelling passed straight through.
    for (const name of [
      "apiKey",
      "apikey",
      "api_key",
      "APIKEY",
      "key",
      "token",
      "access_token",
      "password",
      "sig",
    ]) {
      const url = `https://api.example.com/v1/odds?${name}=super-secret-value`;
      const redacted = redactUrlForDisplay(url);
      expect(redacted).toBe("https://api.example.com/v1/odds");
      expect(redacted).not.toContain("super-secret-value");
    }
  });

  it("handles a URL embedded mid-sentence", () => {
    expect(
      redactUrlForDisplay("request to https://api.example.com/v4/odds?apiKey=abc failed: timeout")
    ).toBe("request to https://api.example.com/v4/odds failed: timeout");
  });

  it("leaves a query-free URL untouched", () => {
    expect(redactUrlForDisplay("https://api.example.com/v4/sports")).toBe(
      "https://api.example.com/v4/sports"
    );
    expect(redactUrlForDisplay("no url at all")).toBe("no url at all");
  });

  it("does not choke on malformed or non-http text", () => {
    for (const input of ["", "://", "https://", "just prose with ? and & signs", "a://b?c=d"]) {
      expect(() => redactUrlForDisplay(input)).not.toThrow();
    }
  });
});

describe("fetchJson error messages", () => {
  const key = "sk-live-do-not-log-me";

  it("redacts the key from an HTTP error", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      ({ ok: false, status: 500, json: async () => ({}) }) as unknown as Response) as typeof fetch;
    try {
      await expect(
        fetchJson(`https://api.example.com/v4/odds?apiKey=${key}&regions=uk`, {})
      ).rejects.toSatisfy((error: unknown) => {
        const message = (error as Error).message;
        expect(message).not.toContain(key);
        expect(message).toContain("HTTP 500");
        expect(message).toContain("https://api.example.com/v4/odds");
        return error instanceof ProviderTransportError;
      });
    } finally {
      globalThis.fetch = original;
    }
  });

  it("redacts a key embedded in a network error message", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new TypeError(`fetch failed for https://api.example.com/v4/odds?apiKey=${key}`);
    }) as unknown as typeof fetch;
    try {
      await expect(
        fetchJson(`https://api.example.com/v4/odds?apiKey=${key}`, {})
      ).rejects.toSatisfy((error: unknown) => {
        const message = (error as Error).message;
        expect(message).not.toContain(key);
        expect(message).toContain("network error");
        return true;
      });
    } finally {
      globalThis.fetch = original;
    }
  });
});
