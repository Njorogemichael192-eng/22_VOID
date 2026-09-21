import { type CanonicalEvent, canonicalEventSchema } from "@22void/domain";

import { createDefaultCompetitionDictionary, createDefaultTeamDictionary } from "./dictionaries";
import type { CompetitionDictionary, TeamDictionary } from "./dictionaries";
import { classifyMatch, computeMatchConfidence } from "./matching";
import type { MatchPolicy, NormalizedEventRef } from "./matching";
import { SourceIdIndex } from "./source-ids";

/**
 * Event normalizer / registry (Phase 4).
 *
 * Ingests provider events, deduplicates them, and merges different provider
 * views of the same match into one canonical event. The golden rule from the
 * spec is enforced here: **uncertain matches are never silently merged** — a
 * near-match is returned as `action: "uncertain"` with its scoring breakdown
 * for a supervising step to resolve.
 */

export interface IncomingEventInput {
  provider: string;
  sourceEventId: string;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  startTime: string;
}

export type NormalizeAction = "created" | "merged" | "uncertain";

export interface NormalizeResult {
  action: NormalizeAction;
  canonicalEvent: CanonicalEvent | undefined;
  canonicalEventId: string | undefined;
  confidence: number;
  reasons: string[];
}

export interface EventNormalizerOptions {
  teamDictionary?: TeamDictionary;
  competitionDictionary?: CompetitionDictionary;
  policy?: MatchPolicy;
  /** Pre-installed canonical events (e.g. loaded from the database). */
  seedEvents?: readonly CanonicalEvent[];
  /** Pre-existing source-ID bindings to resume after a restart. */
  seedSourceIndex?: SourceIdIndex;
}

export class EventNormalizer {
  private readonly teams: TeamDictionary;
  private readonly competitions: CompetitionDictionary;
  private readonly policy: MatchPolicy | undefined;
  private readonly index: SourceIdIndex;
  private readonly stored = new Map<string, CanonicalEvent>();

  constructor(options?: EventNormalizerOptions) {
    this.teams = options?.teamDictionary ?? createDefaultTeamDictionary();
    this.competitions = options?.competitionDictionary ?? createDefaultCompetitionDictionary();
    this.policy = options?.policy;
    this.index = options?.seedSourceIndex ?? new SourceIdIndex();
    for (const event of options?.seedEvents ?? []) {
      this.stored.set(event.canonicalEventId, event);
      for (const ref of event.sourceEventIds) {
        this.index.register(ref.provider, ref.sourceEventId, event.canonicalEventId);
      }
    }
  }

  /** All canonical events held by the normalizer. */
  events(): CanonicalEvent[] {
    return [...this.stored.values()];
  }

  /** Live source-ID bindings (can be persisted alongside events). */
  sourceIndex(): SourceIdIndex {
    return this.index;
  }

  /** Ingest one provider event and decide: create, merge, or hold as uncertain. */
  register(input: IncomingEventInput): NormalizeResult {
    const duplicateId = this.index.lookup(input.provider, input.sourceEventId);
    if (duplicateId !== undefined) {
      const existing = this.stored.get(duplicateId);
      if (existing === undefined) {
        return this.uncertain(input, "sourceEventId bound to a missing canonical event");
      }
      return {
        action: "merged",
        canonicalEvent: existing,
        canonicalEventId: existing.canonicalEventId,
        confidence: 1.0,
        reasons: ["duplicate sourceEventId"],
      };
    }

    const probe: NormalizedEventRef = {
      provider: input.provider,
      sourceEventId: input.sourceEventId,
      homeTeam: input.homeTeam,
      awayTeam: input.awayTeam,
      competition: input.competition,
      startTime: input.startTime,
    };

    let best:
      { event: CanonicalEvent; assessment: ReturnType<typeof computeMatchConfidence> } | undefined;
    for (const candidate of this.stored.values()) {
      const ref: NormalizedEventRef = {
        provider: candidate.sourceEventIds[0]?.provider ?? "",
        sourceEventId: candidate.sourceEventIds[0]?.sourceEventId ?? "",
        homeTeam: candidate.homeTeam,
        awayTeam: candidate.awayTeam,
        competition: candidate.competition,
        startTime: candidate.startTime,
      };
      const assessment = computeMatchConfidence(
        probe,
        ref,
        this.teams,
        this.competitions,
        this.policy
      );
      if (best === undefined || assessment.score > best.assessment.score) {
        best = { event: candidate, assessment };
      }
    }

    if (best === undefined) {
      return this.create(input);
    }

    const kind = classifyMatch(best.assessment, this.policy);
    if (kind === "confirmed") {
      return this.merge(input, best.event, best.assessment);
    }
    if (kind === "uncertain") {
      return this.uncertain(input, best.assessment.reasons.join("; "));
    }
    return this.create(input);
  }

  private create(input: IncomingEventInput): NormalizeResult {
    const homeTeam = this.teams.resolve(input.homeTeam).canonicalName;
    const awayTeam = this.teams.resolve(input.awayTeam).canonicalName;
    if (homeTeam === awayTeam) {
      return this.uncertain(input, "home and away team resolve to the same name");
    }
    const competition = this.competitions.resolve(input.competition).canonicalName;
    const canonicalEventId = `${input.provider}:${input.sourceEventId}`;
    const event = canonicalEventSchema.parse({
      canonicalEventId,
      competition,
      homeTeam,
      awayTeam,
      startTime: input.startTime,
      sourceEventIds: [{ provider: input.provider, sourceEventId: input.sourceEventId }],
    });
    this.stored.set(canonicalEventId, event);
    this.index.register(input.provider, input.sourceEventId, canonicalEventId);
    return {
      action: "created",
      canonicalEvent: event,
      canonicalEventId,
      confidence: 1.0,
      reasons: [],
    };
  }

  private merge(
    input: IncomingEventInput,
    target: CanonicalEvent,
    assessment: ReturnType<typeof computeMatchConfidence>
  ): NormalizeResult {
    const alreadyBound = target.sourceEventIds.some(
      (ref) => ref.provider === input.provider && ref.sourceEventId === input.sourceEventId
    );
    const event = !alreadyBound
      ? canonicalEventSchema.parse({
          ...target,
          sourceEventIds: [
            ...target.sourceEventIds,
            { provider: input.provider, sourceEventId: input.sourceEventId },
          ],
        })
      : target;
    if (!alreadyBound) {
      this.stored.set(event.canonicalEventId, event);
      this.index.register(input.provider, input.sourceEventId, event.canonicalEventId);
    }
    return {
      action: "merged",
      canonicalEvent: event,
      canonicalEventId: event.canonicalEventId,
      confidence: assessment.score,
      reasons: assessment.reasons,
    };
  }

  private uncertain(input: IncomingEventInput, reason: string): NormalizeResult {
    return {
      action: "uncertain",
      canonicalEvent: undefined,
      canonicalEventId: undefined,
      confidence: 0,
      reasons: [reason],
    };
  }
}
