import { normalizeCompetition, normalizeTeamName } from "./text";

/**
 * Alias dictionaries (Phase 4 §6).
 *
 * Provider wire names are resolved to a canonical team/competition through a
 * seeded dictionary. Lookup uses the normalized text key only — nothing here
 * is fuzzy or probabilistic; an unrecognized name resolves to itself ("new")
 * so a fresh wire label never collides with a known team by accident.
 */

export type LookupKind = "direct" | "alias" | "new";

export interface TeamLookup {
  canonicalName: string;
  kind: LookupKind;
}

export interface CompetitionLookup {
  canonicalName: string;
  kind: LookupKind;
}

function register(
  map: Map<string, string>,
  canonical: string,
  aliases: readonly string[],
  keyOf: (value: string) => string
): void {
  const canonicalKey = keyOf(canonical);
  map.set(canonicalKey, canonical);
  for (const alias of aliases) {
    map.set(keyOf(alias), canonical);
  }
}

export class TeamDictionary {
  private readonly map = new Map<string, string>();

  constructor(seed?: readonly (readonly [string, readonly string[]])[]) {
    if (seed === undefined) return;
    for (const [canonical, aliases] of seed) {
      this.add(canonical, aliases);
    }
  }

  /** Register or extend the aliases for a canonical team. */
  add(canonical: string, aliases: readonly string[] = []): void {
    register(this.map, canonical, aliases, normalizeTeamName);
  }

  /** Resolve a wire name to its canonical team name. */
  resolve(name: string): TeamLookup {
    const key = normalizeTeamName(name);
    const canonical = this.map.get(key);
    if (canonical === undefined) return { canonicalName: name.trim(), kind: "new" };
    if (key === normalizeTeamName(canonical)) return { canonicalName: canonical, kind: "direct" };
    return { canonicalName: canonical, kind: "alias" };
  }
}

export class CompetitionDictionary {
  private readonly map = new Map<string, string>();

  constructor(seed?: readonly (readonly [string, readonly string[]])[]) {
    if (seed === undefined) return;
    for (const [canonical, aliases] of seed) {
      this.add(canonical, aliases);
    }
  }

  add(canonical: string, aliases: readonly string[] = []): void {
    register(this.map, canonical, aliases, normalizeCompetition);
  }

  resolve(name: string): CompetitionLookup {
    const key = normalizeCompetition(name);
    const canonical = this.map.get(key);
    if (canonical === undefined) return { canonicalName: name.trim(), kind: "new" };
    if (key === normalizeCompetition(canonical)) {
      return { canonicalName: canonical, kind: "direct" };
    }
    return { canonicalName: canonical, kind: "alias" };
  }
}

/** Built-in team aliases. Extensible at runtime; production builds load more. */
export const TEAM_ALIASES: readonly (readonly [string, readonly string[]])[] = [
  ["Manchester United", ["Man Utd", "Man United", "Manchester Utd"]],
  ["Manchester City", ["Man City"]],
  ["Liverpool", ["Liverpool FC", "LFC"]],
  ["Chelsea", ["Chelsea FC"]],
  ["Arsenal", ["Arsenal FC"]],
  ["AC Milan", ["Milan", "A.C. Milan", "Ac Milan"]],
  ["Inter Milan", ["Inter", "FC Internazionale", "Internazionale"]],
  ["Barcelona", ["FC Barcelona", "Barca"]],
  ["Real Madrid", ["Real Madrid CF", "Real Madrid C.F."]],
  ["Bayern Munich", ["FC Bayern", "Bayern München", "FC Bayern Munchen"]],
  ["Paris Saint-Germain", ["PSG", "Paris SG", "Paris Saint Germain"]],
  ["Benfica", ["SL Benfica", "Benfica Lisbon"]],
];

/** Built-in competition aliases. Canonical form keeps the provider-style label. */
export const COMPETITION_ALIASES: readonly (readonly [string, readonly string[]])[] = [
  ["England - Premier League", ["EPL", "English Premier League", "Premier League"]],
  ["Spain - La Liga", ["LaLiga", "La Liga", "Primera Division"]],
  ["Italy - Serie A", ["Serie A", "Italian Serie A"]],
  ["Germany - Bundesliga", ["Bundesliga"]],
  ["France - Ligue 1", ["Ligue 1", "French Ligue 1"]],
];

/** A dictionary pre-seeded with the built-in football aliases. */
export function createDefaultTeamDictionary(): TeamDictionary {
  return new TeamDictionary(TEAM_ALIASES);
}

export function createDefaultCompetitionDictionary(): CompetitionDictionary {
  return new CompetitionDictionary(COMPETITION_ALIASES);
}
