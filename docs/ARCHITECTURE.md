# 22_VOID — Architecture

Version: 1.2 | 2026-09-23

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

## Worker scan cycle (Phase 14)

`workers/odds-collector` runs one operator loop per interval (`npm run worker:collect`
→ `src/main.ts`, `createScanWorker` in `src/runtime.ts`). Each `runScanCycle`:

1. **Heartbeat** the run is starting (`recordHeartbeat`, status `HEALTHY`).
2. **Rate-limit** — token bucket (`src/rate-limit.ts`) so a provider's quota is never exceeded.
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
   `invalid`, never guessed.
6. **Persist** via `@22void/db` (`persistCanonicalRun`: events → source bindings →
   settlement rules → markets → selections; idempotent upserts).
7. **Detect** (`src/detect.ts`): reads the fresh priced selections, runs the Phase 10
   `scanCandidates` + Phase 11 `validateCandidate` pipeline, and persists every ARB scan's
   outcome (verified/theoretical/stale/rejected) with its audit trail
   (`persistOpportunity`). The §39 recheck is served by the cycle itself: current prices
   *are* the recheck, so scans are self-consistent.
8. **Availability + heartbeat**: a successful cycle marks the source `HEALTHY`; a failed
   poll marks it `DOWN`. The very next successful cycle flips it back — the worker
   acceptance model is *transient provider failures recover*.

The worker talks to `@22void/db` only through the `WorkerStore` port (`src/store.ts`);
a Prisma-backed adapter and an in-memory adapter (tests/sandbox) implement it.

```text
Scanner loop (workers/odds-collector)
   poll (rate-limited, retried) -> raw payload §65
      -> normalize (events/confidence) -> persistCanonicalRun
      -> detect (scan + validate) -> persistOpportunity
      -> reconcile opportunity episodes (sweep/restore)
      -> heartbeat + source availability (HEALTHY/DEGRADED/DOWN)
```

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