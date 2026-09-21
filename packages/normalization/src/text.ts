/**
 * Text normalization (Phase 4 §6).
 *
 * Provider labels (team names, competitions) are normalized before any alias
 * lookup or equality comparison: Unicode normalization (NFKC), combining-mark
 * (diacritics) removal, case folding, punctuation → spaces, whitespace collapse.
 * Altering names beyond this point must go through the alias dictionaries — the
 * normalizer never guesses that "FC" means anything, for example.
 */

/** Collapse runs of whitespace to a single space and trim. */
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

/** Strip combining marks (é → e, ü → u) so accented and ASCII forms compare equal. */
export function stripDiacritics(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "");
}

/** Replace punctuation with spaces (letters/numbers only survive). */
export function collapsePunctuation(value: string): string {
  return value.replace(/[^\p{L}\p{N}]+/gu, " ");
}

/**
 * Canonical text form used for team and competition identity. Everything the
 * engine compares passes through this first.
 */
export function normalizeText(value: string): string {
  const folded = value.normalize("NFKC").toLocaleLowerCase("und");
  return collapseWhitespace(collapsePunctuation(stripDiacritics(folded)));
}

/** Normalize a team name to its canonical comparison key. */
export function normalizeTeamName(value: string): string {
  return normalizeText(value);
}

/** Normalize a competition name to its canonical comparison key. */
export function normalizeCompetition(value: string): string {
  return normalizeText(value);
}
