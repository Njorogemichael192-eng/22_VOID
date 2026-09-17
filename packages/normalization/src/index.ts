/**
 * @22void/normalization
 *
 * Event + market normalization (BUILD_AGENT_PROMPT Phases 4–5).
 * Converts provider-specific labels into canonical events (team names, home/away,
 * competition, start time, source IDs) and canonical markets (market family,
 * period, participant, line). Never merges uncertain events; never treats
 * different market families as interchangeable.
 *
 * Status: Phase 0 skeleton. Implemented in Phases 4–5.
 */

/** Placeholder for a normalized source-ID mapping record (Phase 4). */
export interface SourceIdMapping {
  provider: string;
  sourceEventId: string;
  canonicalEventId: string;
}

/** Placeholder for a normalization result envelope (Phase 4/5). */
export interface NormalizationOutcome<T> {
  normalized: boolean;
  value?: T;
  confidence: number;
}