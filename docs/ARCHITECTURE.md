# 22_VOID — Architecture

Version: 1.3 | 2026-10-10

## System topology

```text
Browser
   |  (React dashboard)
   v
Next.js App (apps/web)
   |  Application API (Route Handlers)
   v
PostgreSQL (Supabase)  <---------------  Prisma client (packages/db)
   ^                                       ^
   |                                       |
Background:                                |
   Odds Provider (ParlayAPI / Odds-API.io) |
       |                                   |
       v                                   |
   Provider Adapter (packages/provider-contracts)
       |  raw payload capture
       v
   Normalizer (packages/normalization)
       |  events + markets
       v
   Persistence (packages/db -> prisma)
       |
       v
   Settlement + State Engine (packages/settlement, packages/outcome-engine)
       |
       v
   Arbitrage Engine (packages/arbitrage)
       |
       v
   Opportunities -> API -> Dashboard
```

## Module boundaries

| Package | Responsibility | Crosses boundary to |
|---|---|---|
| `@22void/shared` | math/time/zod helpers; no business logic | — |
| `@22void/domain` | canonical enums & value sets | — |
| `@22void/provider-contracts` | `OddsProvider` interface + mock/live adapters | domain, shared |
| `@22void/normalization` | event + market normalization | domain |
| `@22void/settlement` | settlement rules + payout multipliers | domain |
| `@22void/outcome-engine` | football score-state model, state classes | domain, settlement |
| `@22void/arbitrage` | candidate scan, coverage, optimizer | domain, settlement, outcome-engine |
| `@22void/db` | Prisma client access layer | — |
| `apps/web` | dashboard, public/authenticated API | shared, domain, db |
| `workers/odds-collector` | scheduled collection, rate-limit, retry/backoff, raw payload capture, normalization + detection jobs, heartbeat, source availability | provider-contracts, normalization, arbitrage, db |

Rule: provider-specific logic stays in adapters under `provider-contracts`; the core engine never imports provider internals.

## Worker scan cycle (Phases 14, 19)

`workers/odds-collector` runs one operator loop per interval (`npm run worker:collect`
→ `src/main.ts`, `createScanWorker` in `src/runtime.ts`). `WORKER_PROVIDER` is a
comma-separated list, and each `runScanCycle` polls **every provider it names, in
order, then detects once over the combined prices**.

Per provider, in list order:

1. **Heartbeat** — one `scanner_health` row opened for this provider
   (`recordHeartbeat`, status `HEALTHY`, `oddsSourceId` set). One row *per provider
   per cycle*, not one per cycle: `sourceLatencyStats` groups by `oddsSourceId`, so a
   second provider with no row of its own would have no latency history at all and
   `/api/v1/history/latency` would silently cover only the first feed.
2. **Rate-limit** — token bucket (`src/rate-limit.ts`), shared across providers, so
   the combined request rate never exceeds what the operator configured.
3. **Poll** with retry/backoff (`src/retry.ts`): 429/5xx/network errors are transient and
   retried (4 attempts, exponential ±50% jitter); permanent 4xx re-raise immediately.
4. **Raw payload capture** (§65): the verbatim provider response is stored via
   `storeRaw` before any interpretation.
5. **Normalize** (`src/normalize.ts`): canonical records → `EventNormalizer` merge against
   events already in the store; match confidence is persisted into
   `source_event_ids.eventConfidence`. Because the DB keys markets by
   `(oddsSourceId, sourceMarketId)` and a provider may reuse a market id across events,
   the persisted `sourceMarketId` is the provider's canonical composite
   `${providerEventId}:${sourceMarketId}`. Unrepresentable records are counted as
   `invalid`, never guessed. `loadEventSeeds` is read *inside* the provider loop, so a
   second provider resumes from the first provider's bindings — the same match arriving
   from two feeds folds into one canonical event rather than becoming two.
6. **Persist** via `@22void/db` (`persistCanonicalRun`: events → source bindings →
   settlement rules → markets → selections; idempotent upserts), and this provider's
   source availability is written: `HEALTHY` before the store writes, `DOWN` on a poll
   that failed after its retries, `DEGRADED` when processing failed after the poll.

Then, once for the whole cycle:

 7. **Detect** (`src/detect.ts`): reads the fresh priced selections, applies spec §55
    best-price bookmaker selection per generation group (`eventId|period`), runs the Phase 10
    `scanCandidates` + Phase 11 `validateCandidate` pipeline, and persists every ARB scan's
    outcome (verified/theoretical/stale/rejected) with its audit trail
    (`persistOpportunity`). The §39 recheck is served by the cycle itself: current prices
    *are* the recheck, so scans are self-consistent. Candidate generation is bounded by
    `maxCandidates` (default `DEFAULT_MAX_CANDIDATES` = 20 000) and the summary reports
    `capped`, so a truncated search is distinguishable from an exhausted one. It runs
    **after the last provider has persisted and only once**, because an arbitrage between
    a book on one provider and a book on another exists only once both feeds are in the
    store — running it per provider would compare each feed against itself. `now` is the
    freshest envelope in the cycle, so a slower provider cannot flatter a faster
    provider's prices.
 8. **Reconcile** opportunity episodes (Phase 15 sweep/restore), also once per cycle.

Each provider's still-open heartbeat row is then closed with that detection summary in
its `message`, while `finishedAt` stays pinned to the moment *that provider's* persist
completed — so the latency `sourceLatencyStats` reports remains poll→persist for that
source instead of absorbing the other providers' polls.

9. **Availability + heartbeat** (per provider): the acceptance model is *transient
   provider failures recover* — `DOWN` on the next successful poll flips straight back
   to `HEALTHY`. A detection failure is deliberately **not** written back onto the
   providers: they delivered their prices, so the sources stay `HEALTHY` and the
   **cycle** reports `DEGRADED`, which is what `/healthz` consumes.

The cycle's status aggregates the two: all providers alike → that status; any mixture,
or a detection failure → `DEGRADED`. One feed failing therefore can neither hide the
prices that arrived nor be hidden by them.

The worker talks to `@22void/db` only through the `WorkerStore` port (`src/store.ts`);
a Prisma-backed adapter and an in-memory adapter (tests/sandbox) implement it.

```text
Scanner loop (workers/odds-collector)
   for each provider in WORKER_PROVIDER:
      heartbeat open (one row per provider per cycle)
        -> rate-limit (shared) -> poll (retried) -> raw payload §65
        -> normalize (events/confidence, seeds re-read per provider)
        -> persistCanonicalRun -> source availability
        -> heartbeat close (finishedAt = this provider's persist)
   then once:
        detect (scan + validate, combined prices) -> persistOpportunity
        -> reconcile opportunity episodes (sweep/restore)
        -> close each provider's heartbeat message with the detection summary
   cycle status = OK | DEGRADED | DOWN (see aggregate rule above)
```

**Freshness is measured against price age, not poll age — so at the current cadence
`VERIFIED_ARB` is unreachable by construction.** The 15 s recheck window
(`DEFAULT_FRESHNESS_POLICY.agingMs`) bounds `now - sourceUpdatedAt`, where `sourceUpdatedAt`
is the bookmaker's own timestamp on the quote, not the moment the worker last polled. A poll
interval of 90 minutes therefore guarantees every leg is read far outside the window:
`classifyFreshness` reports `STALE` and `validateCandidate` takes the stale branch
(`STALE`/`STALE_ODDS`) before the `VERIFIED_ARB` path can be reached — even though the §39
recheck itself compares the cycle's own prices and would pass. This is the honest reading
(an hour-old quote cannot be guaranteed), so it is documented rather than weakened. The
persisted `expiresAt` records the horizon that was already missed (oldest leg age +
`maxAgeMs`), which is what `explain` renders as "prices are no longer guaranteed fresh", and
`validatedAt` records when the recheck ran. Shortening the interval to sit inside the window
is a paid-plan decision (a 15 s cadence burns the 500-credit free plan in hours), not an
engine change: the policy stays at 15 s until then, and `STALE` is the expected steady state
on the free plan.

## Cross-provider event matching (Phase 19, Step 4)

`EventNormalizer.register` already folds the *same* match from two feeds into one
canonical event, but only for events it sees within a single ingest: it
short-circuits on an already-bound `(provider, sourceEventId)` and compares only
against the seeds loaded at the start of the cycle, so a fixture provider A
persisted on an earlier cycle is not re-examined when provider B arrives. Provider
B's copy of that fixture therefore lands as a *second* canonical event. Cross-
provider event matching is thus a **backfill**, not a scan-cycle change — the live
cycle already matches everything it can see.

`planEventReconcile` (`packages/normalization`) is a pure planner over the persisted
events. It proposes folds using the same `computeMatchConfidence` the live path
uses, and the rules are deliberately narrow:

- **cross-provider only** — two `parlay-api` events that merely look alike are never
  merged; only pairs with differing `provider` qualify;
- **winner** = highest provider priority (`odds-api` > `parlay-api`), then earliest
  `createdAt`, then `canonicalEventId` ascending — so the fold is deterministic and
  independent of listing order;
- candidates are compared against the group's **root** only, so a fold never chains
  a second re-point onto an event that is itself being removed;
- an `uncertain` match is **held** (never merged), preserving the Phase 4 rule that
  uncertain matches require a supervisor.

`applyReconcilePlan` (`packages/db`) executes one fold per transaction. It repoints
`source_event_ids`, `markets`, `opportunities` and `opportunity_episodes` onto the
winner and deletes the loser; the episode repoint is **conflict-aware** against the
unique `(eventId, structureType, legKey)` key, so a loser episode that would collide
with an existing winner episode is not copied blindly. The worker never calls this
path — it is an operator backfill via `npm run db:reconcile-events` (dry-run
default; `--apply --yes` to write). `(Corners)`-style markets whose two feeds use
different market identities are folded at the **event** level only; the markets
stay distinct, which is intended.

Interaction worth knowing: `validateCandidate` rejects a candidate whose legs'
`sourceUpdatedAt` spread exceeds `maxSourceSpreadMs` (default 60s,
`packages/arbitrage/src/validation.ts`). A correctly folded event whose two feeds
stamped their prices more than 60s apart therefore surfaces as
`CROSS_SOURCE_TIMESTAMP_SPREAD` rather than a verified arb — a freshness outcome,
not a matching defect.

## History and reconstruction (Phase 15)

Every detection run is remembered so any historical opportunity can be
reconstructed, including how long it lived and what killed it.

**Identity.** Repeated detections of the *same legs on the same event* are grouped
into an **episode**. The key is deterministic and self-describing rather than a
monotonic id:

```text
episode:${eventCanonicalId}:${structureType}:${sorted unique selectionIds joined "+"}
```

`computeOpportunityKey` (packages/db) derives it from the persisted legs, so the
detection job (which stamps it as `opportunityKey`) and the history layer always
agree. `opportunity_episodes` carries `firstSeenAt`, `lastSeenAt`,
`detectedCount`, `disappearedAt` and the latest `status`; `opportunities` links to
its episode via `episodeId`.

**Observations.** `odds_observations` is the price timeline: the first quoted
price now writes a row (previously only movements did), every later change
appends one, and `selections.observations` counts created-or-changed — so a
leg's series is complete from its first appearance.

**Lifecycle.** Inside `persistOpportunity`'s transaction the episode is upserted
(id → unique `(eventId, structureType, legKey)` → create) and `lastSeenAt` /
`detectedCount` bump on every detection. The worker's reconcile step
(`reconcileOpportunityEpisodes`) runs **only in the healthy OK branch** of the
scan cycle: an episode absent from a healthy cycle is stamped `disappearedAt`
(= when the arb stopped paying); re-detected episodes are restored (un-set).
DOWN/DEGRADED cycles never fabricate disappearances.

**Read model** (`@22void/db` `history.ts`, exposed over `HistoryRepo`):

- `listOpportunityEpisodes` — episode summaries with event context, `durationMs`
  = `lastSeen − firstSeen` (arb duration).
- `getEpisodeReconstruction` — the episode + every per-cycle detection snapshot +
  one `OddsHistoryPoint` series per unique leg with `LegMovement`
  (first/last/min/max/delta/pctChange) → the acceptance case.
- `loadOddsHistory` — per-selection or per-event price series, ISO bounds.
- `sourceLatencyStats` — poll-to-persist cycle latency from `scanner_health`.
- `falsePositiveAnalysis` — concluded episodes by latest status: STALE/REJECTED/
  INVALIDATED are false positives, VERIFIED_ARB verified, with by-status
  duration and the top rejection reasons.

**API.** `apps/web` serves it read-only behind the admin/reader key:
`GET /api/v1/history/opportunities{,/:episodeId}`, `/odds` (`selectionId` or
canonical `eventId` required), `/latency`, `/analysis` — handlers, zod query
schemas and OpenAPI paths/components live in `lib/api` beside the Phase 12 API.

```text
detection -> persistOpportunity (episode upsert + steps)
   -> opportunity_episodes (first/last seen, counts, disappearedAt)
   -> odds_observations (complete price timeline)
   -> HistoryRepo -> GET /api/v1/history/** (reconstruction, movement, latency, FP report)
```

## Data flow per scan cycle

```text
INGEST -> VALIDATE -> NORMALIZE -> MATCH EVENTS -> NORMALIZE MARKETS
-> VERIFY SETTLEMENT -> GENERATE STATES -> BUILD PAYOFF MATRIX
-> VERIFY COVERAGE -> OPTIMIZE STAKES -> CALCULATE MIN RETURN
-> FRESHNESS CHECK -> PERSIST -> DISPLAY
```

The authoritative arb test is the payoff/state model — never `sum(1/odds) < 1` alone.

## Security posture

- API keys live server-side only (hosting secret manager / `.env`).
- External data validated with Zod.
- Public APIs rate-limited.
- No bypass of bookmaker CAPTCHA, bot detection, authentication, geo controls, rate limits or access controls.
- Audit logs for configuration changes.

## Deployment (planned)

- Web: Vercel (initially).
- DB: Supabase PostgreSQL.
- Workers: persistent host when needed (Railway/Render/Fly.io).
- Cache/queue: Redis-compatible service when the workload requires it (Phase 20).