import { describe, expect, it } from "vitest";

import {
  fetchJson,
  formatProviderQuota,
  ProviderTransportError,
  readProviderQuota,
  redactUrlForDisplay,
} from "./http";

/** Minimal stand-in for the subset of `Headers` the quota reader touches. */
function headers(values: Record<string, string>) {
  const lower = new Map(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name: string) => lower.get(name.toLowerCase()) ?? null };
}

describe("readProviderQuota", () => {
  it("reads the three documented quota headers", () => {
    // The Odds API reports these on every response. Without them the remaining
    // balance is only visible by leaving the deployment and reading a dashboard.
    expect(
      readProviderQuota(
        headers({ "x-requests-remaining": "487", "x-requests-used": "13", "x-requests-last": "4" })
      )
    ).toEqual({ remaining: 487, used: 13, last: 4 });
  });

  it("is case-insensitive, as HTTP headers are", () => {
    expect(readProviderQuota(headers({ "X-Requests-Remaining": "100" }))).toEqual({
      remaining: 100,
      used: undefined,
      last: undefined,
    });
  });

  it("returns undefined when the provider reports nothing", () => {
    // Distinct from a zero balance: "unreported" must not read as "exhausted".
    expect(readProviderQuota(headers({ "content-type": "application/json" }))).toBeUndefined();
  });

  it("returns undefined rather than fabricating zeros for absent headers", () => {
    // Reporting 0 for "not sent" would raise a false out-of-quota alarm on every
    // endpoint that legitimately omits them.
    expect(readProviderQuota(headers({ "x-requests-used": "13" }))).toEqual({
      remaining: undefined,
      used: 13,
      last: undefined,
    });
    expect(readProviderQuota(headers({}))).toBeUndefined();
  });

  it("ignores malformed values instead of guessing", () => {
    expect(
      readProviderQuota(
        headers({
          "x-requests-remaining": "many",
          "x-requests-last": "-4",
          "x-requests-used": "1.5",
        })
      )
    ).toBeUndefined();
  });

  it("ignores empty and whitespace-only values", () => {
    expect(readProviderQuota(headers({ "x-requests-remaining": "   " }))).toBeUndefined();
  });

  it("survives a response with no headers at all", () => {
    // Quota reporting is observability and must never break a poll.
    expect(readProviderQuota(undefined)).toBeUndefined();
    expect(readProviderQuota(null)).toBeUndefined();
    expect(readProviderQuota({} as never)).toBeUndefined();
  });

  it("accepts a real zero balance, which is meaningful", () => {
    expect(readProviderQuota(headers({ "x-requests-remaining": "0" }))).toEqual({
      remaining: 0,
      used: undefined,
      last: undefined,
    });
  });
});

describe("formatProviderQuota", () => {
  it("renders all three values", () => {
    expect(formatProviderQuota({ remaining: 487, used: 13, last: 4 })).toBe(
      "remaining=487 used=13 last=4"
    );
  });

  it("marks unknown components rather than hiding them", () => {
    expect(formatProviderQuota({ remaining: 0, used: undefined, last: 4 })).toBe(
      "remaining=0 used=? last=4"
    );
  });

  it("distinguishes unreported from zero", () => {
    expect(formatProviderQuota(undefined)).toBe("unreported");
    expect(formatProviderQuota(null)).toBe("unreported");
    expect(formatProviderQuota({ remaining: 0, used: 500, last: 4 })).toBe(
      "remaining=0 used=500 last=4"
    );
  });
});

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

describe("fetchJson quota reporting", () => {
  function stubResponse(headers: Record<string, string>, ok = true, status = 200) {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok,
      status,
      headers: {
        get: (name: string) => headers[name.toLowerCase()] ?? null,
      },
      json: async () => ({ ok: true }),
    })) as unknown as typeof fetch;
    return () => {
      globalThis.fetch = original;
    };
  }

  it("hands quota headers to the observer on success", async () => {
    const restore = stubResponse({ "x-requests-remaining": "487", "x-requests-used": "13" });
    try {
      let seen: unknown;
      await fetchJson("https://api.example.com/v4/odds", {}, undefined, (meta) => {
        seen = meta;
      });
      expect(seen).toEqual({
        status: 200,
        quota: { remaining: 487, used: 13, last: undefined },
      });
    } finally {
      restore();
    }
  });

  it("reports quota even when the request fails, which is when it matters", async () => {
    // A 401 from an exhausted plan and a 401 from a bad key look identical from
    // the outside. Only remaining=0 separates them, and only if the observer also
    // runs on the failure path.
    const restore = stubResponse(
      { "x-requests-remaining": "0", "x-requests-used": "500" },
      false,
      401
    );
    try {
      let seen: unknown;
      await expect(
        fetchJson("https://api.example.com/v4/odds", {}, undefined, (meta) => {
          seen = meta;
        })
      ).rejects.toBeInstanceOf(ProviderTransportError);
      expect(seen).toEqual({
        status: 401,
        quota: { remaining: 0, used: 500, last: undefined },
      });
    } finally {
      restore();
    }
  });

  it("omits the quota key entirely when no headers are present", async () => {
    const restore = stubResponse({});
    try {
      let seen: unknown;
      await fetchJson("https://api.example.com/v4/odds", {}, undefined, (meta) => {
        seen = meta;
      });
      // Absent rather than three undefineds, so a caller can tell "provider said
      // nothing" from "provider said zero of something".
      expect(seen).toEqual({ status: 200 });
      expect(seen).not.toHaveProperty("quota");
    } finally {
      restore();
    }
  });

  it("stays optional, so existing callers are unaffected", async () => {
    const restore = stubResponse({ "x-requests-remaining": "1" });
    try {
      await expect(fetchJson("https://api.example.com/v4/odds", {})).resolves.toEqual({
        ok: true,
      });
    } finally {
      restore();
    }
  });
});
