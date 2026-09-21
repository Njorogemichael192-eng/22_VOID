/**
 * Source-ID mapping (Phase 4 §6, "source event identifiers").
 *
 * Tracks, for every provider event seen, which canonical event it belongs to.
 * Uniqueness invariant: a given (provider, sourceEventId) pair resolves to at
 * most one canonicalEventId — this is what makes duplicate prevention and the
 * merge of two provider views of the same match possible.
 */

export interface SourceIdMapping {
  provider: string;
  sourceEventId: string;
  canonicalEventId: string;
}

export function sourceIdKey(provider: string, sourceEventId: string): string {
  return `${provider}:${sourceEventId}`;
}

/**
 * Mutable index maintained while events are normalized. Also returned via
 * `snapshot()` so a caller can persist the mappings alongside canonical events.
 */
export class SourceIdIndex {
  private readonly map = new Map<string, string>();

  register(provider: string, sourceEventId: string, canonicalEventId: string): void {
    this.map.set(sourceIdKey(provider, sourceEventId), canonicalEventId);
  }

  /** Returns the canonicalEventId bound to this provider event, if any. */
  lookup(provider: string, sourceEventId: string): string | undefined {
    return this.map.get(sourceIdKey(provider, sourceEventId));
  }

  has(provider: string, sourceEventId: string): boolean {
    return this.lookup(provider, sourceEventId) !== undefined;
  }

  /** All provider events that map to the given canonical event. */
  forCanonicalEvent(canonicalEventId: string): SourceIdMapping[] {
    const mappings: SourceIdMapping[] = [];
    for (const [key, canonical] of this.map) {
      if (canonical !== canonicalEventId) continue;
      const sep = key.indexOf(":");
      mappings.push({
        provider: key.slice(0, sep),
        sourceEventId: key.slice(sep + 1),
        canonicalEventId,
      });
    }
    return mappings;
  }

  snapshot(): SourceIdMapping[] {
    const mappings: SourceIdMapping[] = [];
    for (const [key, canonical] of this.map) {
      const sep = key.indexOf(":");
      mappings.push({
        provider: key.slice(0, sep),
        sourceEventId: key.slice(sep + 1),
        canonicalEventId: canonical,
      });
    }
    return mappings;
  }
}
