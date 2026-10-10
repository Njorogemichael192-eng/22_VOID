import { createDefaultCompetitionDictionary, createDefaultTeamDictionary } from "./dictionaries";
import type { CompetitionDictionary, TeamDictionary } from "./dictionaries";
import { classifyMatch, computeMatchConfidence } from "./matching";
import type { MatchAssessment, MatchPolicy, MatchSignals, NormalizedEventRef } from "./matching";

/**
 * Cross-provider event reconciliation planner (Phase 19 Step 4).
 *
 * The runtime register path (`EventNormalizer.register`) only folds an event
 * while it is still unbound: once a `(provider, sourceEventId)` binding exists,
 * it short-circuits. Events that two providers both created *before* an alias
 * existed therefore stay duplicated forever. This planner repairs that
 * historical state: given every persisted canonical event, it computes a
 * deterministic set of cross-provider folds.
 *
 * It is pure — no database, no I/O — so it can be unit tested and dry-run
 * without touching production. The transactional apply lives in @22void/db and
 * the CLI composes the two.
 *
 * Rules:
 *  - Only events from *different* providers are ever folded; two listings from
 *    the same provider are never merged by this pass.
 *  - The winner is chosen deterministically (provider priority, then earliest
 *    creation, then canonical id) so `odds-api` events survive.
 *  - A near-match that is not confident enough is reported as `uncertain` and
 *    never folded — the same "uncertain matches are never silently merged"
 *    invariant the runtime enforces.
 */

export interface ReconcileSourceRef {
  provider: string;
  sourceEventId: string;
  eventConfidence?: number;
}

export interface ReconcileEventRef {
  canonicalEventId: string;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  startTime: string;
  /** ISO creation time; used only to break winner ties deterministically. */
  createdAt?: string;
  sources: readonly ReconcileSourceRef[];
}

export interface ReconcileMerge {
  winnerCanonicalEventId: string;
  loserCanonicalEventId: string;
  winnerProvider: string;
  loserProvider: string;
  score: number;
  signals: MatchSignals;
  reasons: string[];
  /** The loser's bindings, i.e. exactly what will move onto the winner. */
  sourceEventIds: ReconcileSourceRef[];
}

export interface ReconcileUncertain {
  canonicalEventId: string;
  againstCanonicalEventId: string;
  score: number;
  reasons: string[];
}

export interface ReconcilePlan {
  merges: ReconcileMerge[];
  uncertain: ReconcileUncertain[];
  /** Events that end up in a group of their own (nothing folded into them). */
  standalone: string[];
}

export interface ReconcileOptions {
  /** Lower index wins. Defaults to `["odds-api", "parlay-api"]`. */
  providerPriority?: readonly string[];
  policy?: MatchPolicy;
  teamDictionary?: TeamDictionary;
  competitionDictionary?: CompetitionDictionary;
}

export const DEFAULT_PROVIDER_PRIORITY: readonly string[] = ["odds-api", "parlay-api"];

function providersOf(event: ReconcileEventRef): Set<string> {
  return new Set(event.sources.map((source) => source.provider));
}

function providerRank(provider: string, priority: readonly string[]): number {
  const index = priority.indexOf(provider);
  return index >= 0 ? index : priority.length;
}

function eventRank(event: ReconcileEventRef, priority: readonly string[]): number {
  if (event.sources.length === 0) return priority.length + 1;
  return Math.min(...event.sources.map((source) => providerRank(source.provider, priority)));
}

/** The provider that determined the event's rank (lowest priority index). */
function primaryProvider(event: ReconcileEventRef, priority: readonly string[]): string {
  let best = event.sources[0]?.provider ?? "";
  let bestRank = providerRank(best, priority);
  for (const source of event.sources) {
    const rank = providerRank(source.provider, priority);
    if (rank < bestRank) {
      best = source.provider;
      bestRank = rank;
    }
  }
  return best;
}

function compareEvents(
  a: ReconcileEventRef,
  b: ReconcileEventRef,
  priority: readonly string[]
): number {
  const rank = eventRank(a, priority) - eventRank(b, priority);
  if (rank !== 0) return rank;
  const createdA = a.createdAt ?? "";
  const createdB = b.createdAt ?? "";
  if (createdA !== createdB) return createdA < createdB ? -1 : 1;
  return a.canonicalEventId < b.canonicalEventId
    ? -1
    : a.canonicalEventId > b.canonicalEventId
      ? 1
      : 0;
}

function refOf(event: ReconcileEventRef): NormalizedEventRef {
  const bound = event.sources[0];
  return {
    provider: bound?.provider ?? event.canonicalEventId.split(":")[0] ?? "",
    sourceEventId: bound?.sourceEventId ?? event.canonicalEventId,
    homeTeam: event.homeTeam,
    awayTeam: event.awayTeam,
    competition: event.competition,
    startTime: event.startTime,
  };
}

/**
 * Compute the merge plan for a set of persisted events.
 *
 * Events are visited in winner order. Each event is compared only against the
 * current group roots, so a fold always lands on the group's original winner
 * (no chained re-pointing). A confirmed cross-provider match joins the winner's
 * group; anything else becomes its own root. The result is stable under input
 * permutation.
 */
export function planEventReconcile(
  events: readonly ReconcileEventRef[],
  options: ReconcileOptions = {}
): ReconcilePlan {
  const priority = options.providerPriority ?? DEFAULT_PROVIDER_PRIORITY;
  const teams = options.teamDictionary ?? createDefaultTeamDictionary();
  const competitions = options.competitionDictionary ?? createDefaultCompetitionDictionary();
  const policy = options.policy;

  const ordered = [...events].sort((a, b) => compareEvents(a, b, priority));
  const groups = new Map<string, ReconcileEventRef[]>();
  const seated = new Set<string>();
  const uncertain: ReconcileUncertain[] = [];

  for (const event of ordered) {
    if (seated.has(event.canonicalEventId)) continue;
    const eventProviders = providersOf(event);
    const probe = refOf(event);

    let best: { winner: ReconcileEventRef; assessment: MatchAssessment } | undefined;
    let near: { winner: ReconcileEventRef; assessment: MatchAssessment } | undefined;

    for (const members of groups.values()) {
      const winner = members[0];
      if (winner === undefined) continue;
      const winnerProviders = providersOf(winner);
      const crossProvider = [...eventProviders].every((provider) => !winnerProviders.has(provider));
      if (!crossProvider) continue;

      const assessment = computeMatchConfidence(probe, refOf(winner), teams, competitions, policy);
      const kind = classifyMatch(assessment, policy);
      if (kind === "confirmed") {
        if (best === undefined || assessment.score > best.assessment.score) {
          best = { winner, assessment };
        }
      } else if (kind === "uncertain") {
        if (near === undefined || assessment.score > near.assessment.score) {
          near = { winner, assessment };
        }
      }
    }

    if (best !== undefined) {
      const members = groups.get(best.winner.canonicalEventId);
      members?.push(event);
      seated.add(event.canonicalEventId);
      continue;
    }

    groups.set(event.canonicalEventId, [event]);
    seated.add(event.canonicalEventId);
    if (near !== undefined) {
      uncertain.push({
        canonicalEventId: event.canonicalEventId,
        againstCanonicalEventId: near.winner.canonicalEventId,
        score: near.assessment.score,
        reasons: near.assessment.reasons,
      });
    }
  }

  const merges: ReconcileMerge[] = [];
  const standalone: string[] = [];
  for (const members of groups.values()) {
    const winner = members[0];
    if (winner === undefined) continue;
    if (members.length === 1) {
      standalone.push(winner.canonicalEventId);
      continue;
    }
    for (const loser of members.slice(1)) {
      const assessment = computeMatchConfidence(
        refOf(loser),
        refOf(winner),
        teams,
        competitions,
        policy
      );
      merges.push({
        winnerCanonicalEventId: winner.canonicalEventId,
        loserCanonicalEventId: loser.canonicalEventId,
        winnerProvider: primaryProvider(winner, priority),
        loserProvider: primaryProvider(loser, priority),
        score: assessment.score,
        signals: assessment.signals,
        reasons: assessment.reasons,
        sourceEventIds: [...loser.sources],
      });
    }
  }

  return { merges, uncertain, standalone };
}
