import {
  MARKET_STRUCTURES,
  MarketFamily,
  marketStructureKey,
  marketStructureSchema,
  MarketType,
  Participant,
  Period,
} from "@22void/domain";
import type { MarketStructure } from "@22void/domain";

import { normalizeText } from "./text";

/**
 * Market normalization (Phase 5).
 *
 * Converts provider-specific market descriptors (key, label, outcome names)
 * into canonical market identity: family / period / marketType / participant /
 * line — spec §7. Two hard rules:
 *
 *  1. Equivalent markets normalize identically ("Goals Over/Under",
 *     "Total Goals", "O/U" → MATCH_TOTAL / STANDARD / FULL_MATCH).
 *  2. Non-equivalent markets never interchange: "Home Team Goals O/U" is
 *     TEAM_TOTAL / HOME and never MATCH_TOTAL; corners / cards / goals / shots
 *     are separate families; "Shots O/U" has no canonical family and is
 *     rejected, never guessed.
 *
 * The normalizer has two inputs: provider-native key registries (fed in by
 * `addKey`, Phase 19 providers) and a generic label classifier. Anything that
 * cannot be classified deterministically returns `matched: false` with a
 * reason (Rule 3: unknown settlement ⇒ no arb).
 */

export interface MarketKeyCanon {
  family: MarketFamily;
  marketType: MarketType;
  period: Period;
  participant?: Participant;
  line?: string;
}

export interface ProviderOutcome {
  name: string;
  point?: string;
}

export interface MarketDescriptor {
  provider: string;
  sourceMarketId: string;
  /** Provider-native market key (e.g. "h2h", "team_totals_home"). */
  key: string;
  /** Human market label (e.g. "Total Goals", "Asian Handicap -0.75"). */
  label?: string;
  /** Outcome selections; used to infer a missing line. */
  outcomes?: readonly ProviderOutcome[];
}

export interface MarketResolution {
  family: MarketFamily;
  period: Period;
  marketType: MarketType;
  participant?: Participant;
  line?: string;
  via: "key" | "label";
  /** The key or label that resolved the identity. */
  source: string;
  reasons: string[];
}

export interface MarketNormalizeResult {
  matched: boolean;
  resolution?: MarketResolution;
  reason?: string;
}

/** Canonical decimal line: strip leading "+", comma → dot, reject junk. */
export function formatCanonicalLine(raw: string): string | undefined {
  const t = raw.trim().replace(",", ".").replace(/^\+/, "");
  if (!/^-?[0-9]+(?:\.[0-9]+)?$/.test(t)) return undefined;
  return t;
}

/** Canonical within-event identity of a resolved market (line included). */
export function marketIdentityKey(resolution: MarketResolution): string {
  return marketStructureKey(resolution);
}

function tokenize(label: string): string[] {
  return normalizeText(label)
    .split(" ")
    .filter((token) => token.length > 0);
}

function hasWord(tokens: string[], word: string): boolean {
  return tokens.includes(word);
}

function detectPeriod(tokens: string[]): Period {
  const joined = tokens.join(" ");
  if (joined.includes("extra time")) return Period.EXTRA_TIME;
  const halfIndex = tokens.indexOf("half");
  if (halfIndex >= 0) {
    const before = halfIndex > 0 ? tokens[halfIndex - 1] : undefined;
    if (before === "1st" || before === "first" || before === "1") return Period.FIRST_HALF;
    if (before === "2nd" || before === "second" || before === "2") return Period.SECOND_HALF;
  }
  return Period.FULL_MATCH;
}

function detectParticipant(tokens: string[]): Participant | undefined {
  const joined = tokens.join(" ");
  if (joined.replace(/\s+/g, "") === "1x2") return undefined;
  if (hasWord(tokens, "home") || hasWord(tokens, "hosts")) return Participant.HOME;
  if (hasWord(tokens, "away") || hasWord(tokens, "visitors")) return Participant.AWAY;
  return undefined;
}

/**
 * Last numeric run in a raw label ("2.25", "-0.75", "1,5") as a canonical
 * decimal line. Read from the raw text, never the normalized tokens, because
 * punctuation collapsing turns "2.25" into "2 25".
 */
function extractLineFromLabel(label: string): string | undefined {
  const matches = label.match(/-?[0-9]+(?:[.,][0-9]+)?/gu);
  if (matches === null || matches.length === 0) return undefined;
  const last = matches[matches.length - 1];
  return last === undefined ? undefined : formatCanonicalLine(last);
}

/** Most common line among outcome points/names, else the first found. */
function lineFromOutcomes(outcomes: readonly ProviderOutcome[]): string | undefined {
  const counts = new Map<string, number>();
  for (const outcome of outcomes) {
    const fromPoint = outcome.point !== undefined ? formatCanonicalLine(outcome.point) : undefined;
    if (fromPoint !== undefined) {
      counts.set(fromPoint, (counts.get(fromPoint) ?? 0) + 1);
      continue;
    }
    const fromName = extractLineFromLabel(outcome.name);
    if (fromName !== undefined) {
      counts.set(fromName, (counts.get(fromName) ?? 0) + 1);
    }
  }
  let best: { line: string; count: number } | undefined;
  for (const [line, count] of counts) {
    if (best === undefined || count > best.count) best = { line, count };
  }
  return best?.line;
}

interface ClassifiedFamily {
  family: MarketFamily;
  marketType: MarketType;
  participant?: Participant;
}

function classified(
  family: MarketFamily,
  marketType: MarketType,
  participant?: Participant
): ClassifiedFamily {
  return { family, marketType, ...(participant !== undefined ? { participant } : {}) };
}

function classifyLabel(
  label: string
): { ok: true; family: ClassifiedFamily } | { ok: false; reason: string } {
  const tokens = tokenize(label);
  const joined = tokens.join(" ");

  if (joined.includes("double chance") || joined.includes("doublechance")) {
    return {
      ok: true,
      family: { family: MarketFamily.DOUBLE_CHANCE, marketType: MarketType.DOUBLE_CHANCE },
    };
  }
  if (
    joined.includes("correct score") ||
    joined.includes("exact score") ||
    joined.includes("score cast")
  ) {
    return {
      ok: true,
      family: { family: MarketFamily.EXACT_SCORE, marketType: MarketType.EXACT_SCORE },
    };
  }
  if (
    joined.includes("both teams to score") ||
    joined.includes("both to score") ||
    joined.includes("btts")
  ) {
    return { ok: true, family: { family: MarketFamily.BTTS, marketType: MarketType.BTTS } };
  }
  if (joined.includes("draw no bet") || joined.includes("dnb")) {
    return {
      ok: false,
      reason: `"${label}": draw no bet is intentionally unmapped (Rule 3 — settlement unverified)`,
    };
  }
  if (joined.includes("goalscorer") || joined.includes("player props")) {
    return {
      ok: false,
      reason: `"${label}": player/goalscorer markets are not part of the canonical family set`,
    };
  }
  if (hasWord(tokens, "corners")) {
    return { ok: true, family: { family: MarketFamily.CORNERS, marketType: MarketType.STANDARD } };
  }
  if (hasWord(tokens, "cards") || joined.includes("yellow card") || joined.includes("red card")) {
    return { ok: true, family: { family: MarketFamily.CARDS, marketType: MarketType.STANDARD } };
  }
  if (hasWord(tokens, "shots")) {
    return { ok: false, reason: `"${label}": shots are not part of the canonical family set` };
  }

  const asian = hasWord(tokens, "asian");
  const teamish = hasWord(tokens, "team");
  const participant = detectParticipant(tokens);
  const totalish =
    joined.includes("total") ||
    joined.includes("over") ||
    joined.includes("under") ||
    joined.includes("o u") ||
    joined.includes("goals");

  if (asian) {
    if (hasWord(tokens, "handicap")) {
      return {
        ok: true,
        family: classified(MarketFamily.ASIAN_HANDICAP, MarketType.HANDICAP, participant),
      };
    }
    if (teamish) {
      return {
        ok: true,
        family: classified(MarketFamily.TEAM_ASIAN_TOTAL, MarketType.ASIAN, participant),
      };
    }
    if (totalish) {
      return { ok: true, family: classified(MarketFamily.ASIAN_TOTAL, MarketType.ASIAN) };
    }
  }

  if (teamish && totalish) {
    return {
      ok: true,
      family: classified(MarketFamily.TEAM_TOTAL, MarketType.STANDARD, participant),
    };
  }

  if (hasWord(tokens, "handicap") || joined.includes("hcap")) {
    return {
      ok: true,
      family: classified(MarketFamily.ASIAN_HANDICAP, MarketType.HANDICAP, participant),
    };
  }

  if (totalish) {
    return {
      ok: true,
      family: { family: MarketFamily.MATCH_TOTAL, marketType: MarketType.STANDARD },
    };
  }

  if (
    joined.replace(/\s+/g, "") === "1x2" ||
    joined.includes("match result") ||
    joined.includes("h2h") ||
    joined.includes("three way")
  ) {
    return {
      ok: true,
      family: { family: MarketFamily.MATCH_RESULT, marketType: MarketType.ONE_X_TWO },
    };
  }

  return { ok: false, reason: `cannot classify market "${label}"` };
}

function fillLine(
  resolution: MarketResolution,
  label: string,
  outcomes: readonly ProviderOutcome[] | undefined
): MarketResolution {
  if (!MARKET_STRUCTURES[resolution.family].requiresLine) return resolution;
  const fromLabel = extractLineFromLabel(label);
  const line = fromLabel ?? (outcomes !== undefined ? lineFromOutcomes(outcomes) : undefined);
  if (line === undefined) {
    return {
      ...resolution,
      reasons: [...resolution.reasons, "line not provided in label or outcomes"],
    };
  }
  return { ...resolution, line };
}

function fillParticipant(resolution: MarketResolution, label: string): MarketResolution {
  if (!MARKET_STRUCTURES[resolution.family].requiresParticipant) return resolution;
  const participant = resolution.participant ?? detectParticipant(tokenize(label));
  if (participant === undefined) {
    return {
      ...resolution,
      reasons: [...resolution.reasons, "participant not specified in label"],
    };
  }
  return { ...resolution, participant };
}

/**
 * Provider-agnostic market normalizer. Providers/pre-Phase-19 adapters teach it
 * native keys with `addKey`; everything else is classified by label. Unknown
 * inputs are rejected with a reason rather than guessed.
 */
export class MarketNormalizer {
  private readonly keys = new Map<string, MarketKeyCanon>();

  addKey(provider: string, key: string, canon: MarketKeyCanon): void {
    this.keys.set(`${provider}\0${key}`, canon);
  }

  normalize(descriptor: MarketDescriptor): MarketNormalizeResult {
    const keyHit = this.keys.get(`${descriptor.provider}\0${descriptor.key}`);
    if (keyHit !== undefined) {
      let resolution: MarketResolution = {
        family: keyHit.family,
        period: keyHit.period,
        marketType: keyHit.marketType,
        via: "key",
        source: descriptor.key,
        reasons: [],
      };
      if (keyHit.participant !== undefined)
        (resolution as { participant?: Participant }).participant = keyHit.participant;
      if (keyHit.line !== undefined) (resolution as { line?: string }).line = keyHit.line;
      resolution = fillLine(resolution, descriptor.label ?? "", descriptor.outcomes);
      resolution = fillParticipant(resolution, descriptor.label ?? "");
      return { matched: true, resolution };
    }

    if (descriptor.label === undefined) {
      return {
        matched: false,
        reason: `market key "${descriptor.key}" is unknown for provider "${descriptor.provider}" and no label was provided`,
      };
    }
    const label = descriptor.label;
    const classified = classifyLabel(label);
    if (!classified.ok) {
      return { matched: false, reason: classified.reason };
    }
    let resolution: MarketResolution = {
      family: classified.family.family,
      period: detectPeriod(tokenize(label)),
      marketType: classified.family.marketType,
      via: "label",
      source: label,
      reasons: [],
    };
    const participant = classified.family.participant;
    if (participant !== undefined)
      (resolution as { participant?: Participant }).participant = participant;
    resolution = fillLine(resolution, label, descriptor.outcomes);
    resolution = fillParticipant(resolution, label);
    return { matched: true, resolution };
  }
}

/** Validate a resolution into a full canonical MarketStructure (line-aware). */
export function toStructure(resolution: MarketResolution): MarketStructure | undefined {
  const parsed = marketStructureSchema.safeParse({
    family: resolution.family,
    period: resolution.period,
    marketType: resolution.marketType,
    participant: resolution.participant,
    line: resolution.line,
  });
  return parsed.success ? parsed.data : undefined;
}
