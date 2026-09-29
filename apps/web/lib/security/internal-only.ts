/**
 * Internal-only access control for the readiness endpoint (Phase 18).
 *
 * `/api/v1/ready` is unauthenticated by necessity — Caddy polls it to decide
 * whether to send traffic to this backend — and it touches the database. Left
 * open to the internet it is a free oracle for "is this deployment's database
 * up?" and a probe amplifier on top of that. It is only ever needed by the
 * reverse proxy and the local container healthcheck, so it is restricted to
 * internal address space.
 *
 * **This is defence in depth, not the authoritative control.** The caller
 * identity is derived from `x-forwarded-for` / `x-real-ip`, which are headers —
 * and a header is only as trustworthy as the proxy in front of it. In the
 * shipped topology that holds: `compose.prod.yml` publishes the web port on
 * 127.0.0.1 only, and Caddy 2 ignores client-supplied `x-forwarded-for` unless
 * `trusted_proxies` is configured, so the hop this module reads is the one Caddy
 * observed. If you ever expose the web container directly, keep the port bound
 * to loopback or add a firewall rule; otherwise a client can simply claim an
 * internal address.
 *
 * The closest hop (the *last* `x-forwarded-for` entry) is the one used, not the
 * first: earlier entries are supplied by the client and are therefore forgeable,
 * while the last entry is the one the nearest trusted proxy appended.
 */

/** Ranges treated as internal when `READINESS_ALLOWED_CIDRS` is not set. */
export const DEFAULT_INTERNAL_CIDRS: readonly string[] = [
  "127.0.0.0/8", // IPv4 loopback
  "::1/128", // IPv6 loopback
  "10.0.0.0/8", // RFC1918
  "172.16.0.0/12", // RFC1918 — the Docker bridge range, so Caddy's probe qualifies
  "192.168.0.0/16", // RFC1918
  "169.254.0.0/16", // link-local
  "fc00::/7", // IPv6 unique-local
  "fe80::/10", // IPv6 link-local
];

/** Escape hatch: allow every caller. Disables the restriction entirely. */
const ALLOW_ALL = "*";

interface ParsedAddress {
  readonly family: 4 | 6;
  readonly value: bigint;
}

interface ParsedCidr {
  readonly family: 4 | 6;
  readonly address: bigint;
  readonly prefixBits: number;
}

function parseIpv4(raw: string): bigint | undefined {
  const parts = raw.split(".");
  if (parts.length !== 4) return undefined;
  let out = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const octet = Number(part);
    if (octet > 255) return undefined;
    out = (out << 8n) | BigInt(octet);
  }
  return out;
}

function parseIpv6(raw: string): bigint | undefined {
  let text = raw.trim().toLowerCase();
  if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1);
  const zone = text.indexOf("%");
  if (zone !== -1) text = text.slice(0, zone);
  if (!text.includes(":")) return undefined;

  // Rewrite a trailing dotted quad (::ffff:127.0.0.1) into two hextets.
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIpv4(tail);
    if (v4 === undefined) return undefined;
    text = `${text.slice(0, lastColon + 1)}${((v4 >> 16n) & 0xffffn).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return undefined;
  const head = halves[0] === "" ? [] : halves[0]!.split(":");
  const compressed = halves.length === 2;
  const tailGroups = !compressed ? [] : halves[1] === "" ? [] : halves[1]!.split(":");

  let groups: string[];
  if (compressed) {
    const missing = 8 - (head.length + tailGroups.length);
    // "::" must stand for at least one omitted group.
    if (missing < 1) return undefined;
    groups = [...head, ...new Array<string>(missing).fill("0"), ...tailGroups];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return undefined;

  let out = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return undefined;
    out = (out << 16n) | BigInt(parseInt(group, 16));
  }
  return out;
}

function parseAddress(raw: string): ParsedAddress | undefined {
  const text = raw.trim();
  if (text.length === 0) return undefined;
  const v4 = parseIpv4(text);
  if (v4 !== undefined) return { family: 4, value: v4 };
  const v6 = parseIpv6(text);
  if (v6 !== undefined) return { family: 6, value: v6 };
  return undefined;
}

/**
 * An IPv4 address tunnelled through an IPv6 socket (`::ffff:127.0.0.1`) is
 * loopback for every practical purpose, so it is also tested against the IPv4
 * ranges. Node reports exactly this form on dual-stack listeners, so ignoring it
 * would deny a legitimate local healthcheck.
 */
function embeddedIpv4(value: bigint): bigint | undefined {
  if ((value >> 32n) !== 0xffffn) return undefined;
  return value & 0xffffffffn;
}

function parseCidr(raw: string): ParsedCidr | undefined {
  const text = raw.trim();
  if (text.length === 0) return undefined;
  const slash = text.lastIndexOf("/");
  const addressText = slash === -1 ? text : text.slice(0, slash);
  const v4 = parseIpv4(addressText);
  if (v4 !== undefined) {
    const prefixBits = slash === -1 ? 32 : Number(text.slice(slash + 1));
    if (!Number.isInteger(prefixBits) || prefixBits < 0 || prefixBits > 32) return undefined;
    return { family: 4, address: v4, prefixBits };
  }
  const v6 = parseIpv6(addressText);
  if (v6 !== undefined) {
    const prefixBits = slash === -1 ? 128 : Number(text.slice(slash + 1));
    if (!Number.isInteger(prefixBits) || prefixBits < 0 || prefixBits > 128) return undefined;
    return { family: 6, address: v6, prefixBits };
  }
  return undefined;
}

function addressInCidr(address: ParsedAddress, cidr: ParsedCidr): boolean {
  if (address.family !== cidr.family) return false;
  const totalBits = cidr.family === 4 ? 32 : 128;
  if (cidr.prefixBits === 0) return true;
  const shift = BigInt(totalBits - cidr.prefixBits);
  return (address.value >> shift) === (cidr.address >> shift);
}

/** True when `ip` falls inside any of the comma or space separated `cidrs`. */
export function isIpInCidrs(ip: string, cidrs: readonly string[]): boolean {
  const address = parseAddress(ip);
  if (address === undefined) return false;

  const mapped = address.family === 6 ? embeddedIpv4(address.value) : undefined;
  for (const entry of cidrs) {
    const cidr = parseCidr(entry);
    if (cidr === undefined) continue;
    if (addressInCidr(address, cidr)) return true;
    if (mapped !== undefined && addressInCidr({ family: 4, value: mapped }, cidr)) return true;
  }
  return false;
}

/**
 * Best-effort client address for an access-control decision.
 *
 * Uses the last `x-forwarded-for` entry (the hop appended by the nearest trusted
 * proxy) and falls back to `x-real-ip`. Returns undefined when neither header is
 * present or parseable, which callers must treat as "not internal" rather than
 * "unknown, allow" — an unidentifiable caller is not a trusted one.
 */
export function resolveClientIp(request: Request): string | undefined {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded !== null && forwarded.trim().length > 0) {
    const hops = forwarded
      .split(",")
      .map((hop) => normalizeIp(hop))
      .filter((hop): hop is string => hop !== undefined);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp !== null) {
    const normalized = normalizeIp(realIp);
    if (normalized !== undefined) return normalized;
  }
  return undefined;
}

/** Strip brackets, an IPv6 zone id, and an `ipv4:port` suffix. */
function normalizeIp(raw: string): string | undefined {
  let text = raw.trim();
  if (text.length === 0) return undefined;
  if (text.startsWith("[")) {
    const end = text.indexOf("]");
    if (end === -1) return undefined;
    text = text.slice(1, end);
  } else if (text.includes(":")) {
    // A single colon on an IPv4 value is a port suffix, not an IPv6 address.
    const v4 = parseIpv4(text.split(":")[0]!);
    if (v4 !== undefined) text = text.slice(0, text.indexOf(":"));
  }
  return parseAddress(text) === undefined ? undefined : text;
}

export interface InternalOnlyDecision {
  readonly allowed: boolean;
  readonly reason: string;
  readonly clientIp?: string;
  /** The allowlist actually applied, for logging and tests. */
  readonly cidrs: readonly string[];
}

function resolveAllowlist(allowlist?: string): readonly string[] {
  const configured = (allowlist ?? process.env.READINESS_ALLOWED_CIDRS ?? "").trim();
  if (configured.length === 0) return DEFAULT_INTERNAL_CIDRS;
  return configured
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Decide whether `request` comes from internal address space.
 *
 * `allowlist` overrides `READINESS_ALLOWED_CIDRS`; pass `"*"` to disable the
 * restriction (for a deployment whose load balancer probes from a public
 * address). An unparseable allowlist entry is skipped rather than throwing — a
 * typo must not take the endpoint down, but it also must not silently widen the
 * allowlist, so the decision reports what it applied.
 */
export function checkInternalOnly(
  request: Request,
  allowlist?: string,
): InternalOnlyDecision {
  const cidrs = resolveAllowlist(allowlist);
  if (cidrs.includes(ALLOW_ALL)) {
    return { allowed: true, reason: "restriction disabled by allowlist", cidrs };
  }

  const clientIp = resolveClientIp(request);
  if (clientIp === undefined) {
    return {
      allowed: false,
      reason:
        "no x-forwarded-for or x-real-ip header, so the caller cannot be identified as internal",
      cidrs,
    };
  }

  if (isIpInCidrs(clientIp, cidrs)) {
    return { allowed: true, reason: "client address is internal", clientIp, cidrs };
  }
  return { allowed: false, reason: "client address is not internal", clientIp, cidrs };
}
