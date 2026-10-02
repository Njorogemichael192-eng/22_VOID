import { afterEach, describe, expect, it } from "vitest";
import {
  checkInternalOnly,
  DEFAULT_INTERNAL_CIDRS,
  isIpInCidrs,
  resolveClientIp,
} from "./internal-only";

function probeWith(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/v1/ready", { headers });
}

afterEach(() => {
  delete process.env.READINESS_ALLOWED_CIDRS;
});

describe("isIpInCidrs", () => {
  it("matches IPv4 ranges by prefix length", () => {
    expect(isIpInCidrs("127.0.0.1", ["127.0.0.0/8"])).toBe(true);
    expect(isIpInCidrs("10.1.2.3", ["10.0.0.0/8"])).toBe(true);
    expect(isIpInCidrs("172.20.0.5", ["172.16.0.0/12"])).toBe(true);
    expect(isIpInCidrs("172.32.0.5", ["172.16.0.0/12"])).toBe(false);
    expect(isIpInCidrs("192.169.0.1", ["192.168.0.0/16"])).toBe(false);
  });

  it("treats a bare address as a host route", () => {
    expect(isIpInCidrs("10.1.2.3", ["10.1.2.3"])).toBe(true);
    expect(isIpInCidrs("10.1.2.4", ["10.1.2.3"])).toBe(false);
  });

  it("matches IPv6 including compression and prefix length", () => {
    expect(isIpInCidrs("::1", ["::1/128"])).toBe(true);
    expect(isIpInCidrs("fe80::abcd", ["fe80::/10"])).toBe(true);
    expect(isIpInCidrs("febf::1", ["fe80::/10"])).toBe(true);
    expect(isIpInCidrs("fec0::1", ["fe80::/10"])).toBe(false);
    expect(isIpInCidrs("fd00::1", ["fc00::/7"])).toBe(true);
    expect(isIpInCidrs("2001:db8::1", ["fc00::/7", "2001:db8::/32"])).toBe(true);
  });

  it("reads a v4-mapped v6 address against the v4 ranges", () => {
    expect(isIpInCidrs("::ffff:127.0.0.1", ["127.0.0.0/8"])).toBe(true);
    expect(isIpInCidrs("::ffff:10.0.0.9", ["10.0.0.0/8"])).toBe(true);
    expect(isIpInCidrs("::ffff:8.8.8.8", ["127.0.0.0/8"])).toBe(false);
  });

  it("does not cross address families", () => {
    expect(isIpInCidrs("10.0.0.1", ["fc00::/7"])).toBe(false);
    expect(isIpInCidrs("::1", ["127.0.0.0/8"])).toBe(false);
  });

  it("rejects junk instead of throwing", () => {
    expect(isIpInCidrs("not-an-ip", ["127.0.0.0/8"])).toBe(false);
    expect(isIpInCidrs("999.1.1.1", ["0.0.0.0/0"])).toBe(false);
    expect(isIpInCidrs("10.0.0.1", ["nonsense", "10.0.0.0/8"])).toBe(true);
    expect(isIpInCidrs("10.0.0.1", ["10.0.0.0/33"])).toBe(false);
  });
});

describe("resolveClientIp", () => {
  it("prefers the last x-forwarded-for hop", () => {
    const request = probeWith({ "x-forwarded-for": "203.0.113.9, 172.20.0.3" });
    expect(resolveClientIp(request)).toBe("172.20.0.3");
  });

  it("ignores forged earlier hops by taking the nearest one", () => {
    const request = probeWith({ "x-forwarded-for": "10.0.0.1, 172.20.0.3" });
    expect(resolveClientIp(request)).toBe("172.20.0.3");
  });

  it("falls back to x-real-ip", () => {
    expect(resolveClientIp(probeWith({ "x-real-ip": "172.20.0.4" }))).toBe("172.20.0.4");
    expect(resolveClientIp(probeWith({ "x-real-ip": "172.20.0.4:51234" }))).toBe("172.20.0.4");
  });

  it("prefers x-forwarded-for over x-real-ip", () => {
    const request = probeWith({ "x-forwarded-for": "172.20.0.3", "x-real-ip": "203.0.113.9" });
    expect(resolveClientIp(request)).toBe("172.20.0.3");
  });

  it("returns undefined when the caller cannot be identified", () => {
    expect(resolveClientIp(probeWith({}))).toBeUndefined();
    expect(resolveClientIp(probeWith({ "x-forwarded-for": "  " }))).toBeUndefined();
    expect(resolveClientIp(probeWith({ "x-forwarded-for": "garbage" }))).toBeUndefined();
    expect(resolveClientIp(probeWith({ "x-forwarded-for": ", ," }))).toBeUndefined();
  });
});

describe("checkInternalOnly", () => {
  it("allows the loopback and RFC1918 callers the shipped topology uses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.3", "192.168.1.1"]) {
      const decision = checkInternalOnly(probeWith({ "x-forwarded-for": ip }));
      expect(decision.allowed, ip).toBe(true);
    }
  });

  it("denies a public caller", () => {
    const decision = checkInternalOnly(probeWith({ "x-forwarded-for": "203.0.113.9" }));
    expect(decision.allowed).toBe(false);
    expect(decision.clientIp).toBe("203.0.113.9");
  });

  it("denies an unidentified caller instead of guessing", () => {
    const decision = checkInternalOnly(probeWith({}));
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("no x-forwarded-for");
  });

  it("reads READINESS_ALLOWED_CIDRS from the environment", () => {
    process.env.READINESS_ALLOWED_CIDRS = "203.0.113.0/24";
    expect(checkInternalOnly(probeWith({ "x-forwarded-for": "203.0.113.9" })).allowed).toBe(true);
    expect(checkInternalOnly(probeWith({ "x-forwarded-for": "172.20.0.3" })).allowed).toBe(false);
  });

  it("falls back to the internal defaults when the setting is empty", () => {
    process.env.READINESS_ALLOWED_CIDRS = "   ";
    expect(checkInternalOnly(probeWith({ "x-forwarded-for": "172.20.0.3" })).allowed).toBe(true);
    expect(checkInternalOnly(probeWith({ "x-forwarded-for": "203.0.113.9" })).allowed).toBe(false);
  });

  it("accepts an explicit argument over the environment", () => {
    process.env.READINESS_ALLOWED_CIDRS = "10.0.0.0/8";
    const decision = checkInternalOnly(
      probeWith({ "x-forwarded-for": "203.0.113.9" }),
      "203.0.113.0/24"
    );
    expect(decision.allowed).toBe(true);
  });

  it("treats * as an explicit opt-out", () => {
    const decision = checkInternalOnly(probeWith({ "x-forwarded-for": "203.0.113.9" }), "*");
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toContain("disabled");
  });

  it("does not let a malformed entry widen the allowlist", () => {
    const decision = checkInternalOnly(
      probeWith({ "x-forwarded-for": "203.0.113.9" }),
      "0.0.0.0/99"
    );
    expect(decision.allowed).toBe(false);
  });

  it("documents the ranges it applies by default", () => {
    expect(DEFAULT_INTERNAL_CIDRS).toContain("172.16.0.0/12");
    expect(checkInternalOnly(probeWith({ "x-forwarded-for": "172.20.0.3" })).cidrs).toEqual(
      DEFAULT_INTERNAL_CIDRS
    );
  });
});
