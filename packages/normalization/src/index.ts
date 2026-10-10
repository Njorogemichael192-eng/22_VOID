/**
 * @22void/normalization
 *
 * Event + market normalization (BUILD_AGENT_PROMPT Phases 4–5). Event scope:
 * team names, home/away, competition, start time, source IDs — different
 * provider views of the same match merge into one canonical event; uncertain
 * matches are never silently merged. Market scope: provider keys/labels become
 * canonical family / period / marketType / participant / line; equivalent
 * labels normalize identically and different families never interchange.
 */

export {
  collapsePunctuation,
  collapseWhitespace,
  normalizeCompetition,
  normalizeTeamName,
  normalizeText,
  stripDiacritics,
} from "./text";

export {
  CompetitionDictionary,
  COMPETITION_ALIASES,
  createDefaultCompetitionDictionary,
  createDefaultTeamDictionary,
  TEAM_ALIASES,
  TeamDictionary,
} from "./dictionaries";
export type { CompetitionLookup, LookupKind, TeamLookup } from "./dictionaries";

export { classifyMatch, computeMatchConfidence, eventsMatch } from "./matching";
export type { MatchAssessment, MatchPolicy, MatchSignals, NormalizedEventRef } from "./matching";

export { SourceIdIndex, sourceIdKey } from "./source-ids";
export type { SourceIdMapping } from "./source-ids";

export { EventNormalizer } from "./registry";
export type {
  EventNormalizerOptions,
  IncomingEventInput,
  NormalizeAction,
  NormalizeResult,
} from "./registry";

export { DEFAULT_PROVIDER_PRIORITY, planEventReconcile } from "./event-reconcile";
export type {
  ReconcileEventRef,
  ReconcileMerge,
  ReconcileOptions,
  ReconcilePlan,
  ReconcileSourceRef,
  ReconcileUncertain,
} from "./event-reconcile";

export {
  DEFAULT_MARKET_PROVIDER_PRIORITY,
  marketRefKey,
  planMarketReconcile,
} from "./market-reconcile";
export type {
  ReconcileMarketMerge,
  ReconcileMarketOptions,
  ReconcileMarketPlan,
  ReconcileMarketRef,
} from "./market-reconcile";

export { formatCanonicalLine, MarketNormalizer, marketIdentityKey, toStructure } from "./market";
export type {
  MarketDescriptor,
  MarketKeyCanon,
  MarketNormalizeResult,
  MarketResolution,
  ProviderOutcome,
} from "./market";
