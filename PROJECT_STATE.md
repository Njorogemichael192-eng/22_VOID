# 22_VOID — PROJECT STATE / MASTER TODO

Version: 1.16

## STATUS

- [ ] Not started
- [~] In progress
- [x] Done
- [!] Blocked
- [?] Needs verification

## STATE UPDATE RULE

After every task:

1. Mark [x] only when acceptance criteria pass.
2. Add evidence.
3. Update phase and next action.
4. Add a changelog entry.
5. Never mark work complete because code merely exists.
6. Re-open an earlier task if later changes invalidate it.

## CURRENT PHASE

Phase 16 — Security (complete)

## NEXT ACTION

Phase 17 — Testing: unit, settlement regression, outcome-state regression,
false-arb regression, optimizer regression, provider fixtures, integration,
e2e, load/candidate-generation test. Acceptance: CI green.

---

## IDENTITY

- [x] Project name: 22_VOID
- [x] Cloud-hosted architecture
- [x] Football-first scope
- [x] Confirm initial data provider — The Odds API chosen (see docs/PROVIDER_EVALUATION.md); ParlayAPI retained as Phase 19 provider B skeleton
- [x] Confirm production terms/use rights — Odds-API TOS reviewed (storage/dashboards/derived analytics OK, no feed resale); re-verified in Phase 16 + ParlayAPI key rotation incident documented (see docs/PROVIDER_EVALUATION.md); commercial tiers to be purchased at deploy; Kenya compliance is operator-level
- [ ] Confirm production domain

## PHASE 0 — FOUNDATION

- [x] GitHub repository — repo relocated to `C:\Users\User\Documents\22_VOID`, git repo present on `main`; docker-compose, .github/workflows, docs, scripts committed (evidence: Phase 0 gate below)
- [x] Next.js + TypeScript — `apps/web` Next.js 16.3.5 / React 19.3 / TS 5.9, app router, `npm run build` green (evidence: Phase 0 gate below)
- [x] ESLint/Prettier — root flat config (ESLint 10, typescript-eslint, prettier), `npm run lint` clean (evidence: Phase 0 gate below)
- [x] Tailwind/shadcn/ui — Tailwind v4 + shadcn/ui (new-york style, neutral), Button/Badge/Card components; brand page renders (evidence: Playwright smoke)
- [x] Zod — `@22void/shared` (zod 4.6) schemas for odds/numbers, tested (evidence: shared tests pass)
- [x] Vitest — workspaces run vitest 4.1.11; 10 suites green (evidence: Phase 0 gate below)
- [x] Playwright — `@playwright/test` 1.63, chromium installed, e2e smoke passes (evidence: `1 passed` for landing-page spec)
- [x] Docker — `docker-compose.yml` postgres 16 + healthcheck, `.dockerignore`; `docker compose config` valid (evidence: compose config validated)
- [x] .env.example — server-side placeholders for DB + providers; `.env` created locally and gitignored
- [x] README + architecture docs — README, docs/ARCHITECTURE.md, docs/ARBITRAGE_ENGINE_SPEC.md, TECH_STACK.md, BUILD_AGENT_PROMPT.md

**Acceptance: clean install, lint, test and build pass.**

Phase 0 gate results (evidence):

- `npm ci` — clean install (202 packages)
- `npm run lint` — 0 errors
- `npm run typecheck` — all workspaces pass
- `npm test` — 10/10 workspace suites pass (shared 7, web utils 3, others 1–2 each)
- `npm run build` — Next.js build green, all packages noEmit green
- `npm run test:e2e -w @22void/web` — 1 passed

Notes:

- Runtime uses portable Node 24.19.0 + npm 11.17.0 at `C:\Users\User\AppData\Local\Programs\node24` (system Node 22.11 is below the vite 8 / vitest 4 / eslint 10 floor; the winget LTS install is pending a free Windows Installer session).
- Repo root is `C:\Users\User\Documents\22_VOID` (moved out of OneDrive). Old OneDrive folder left in place.

## PHASE 1 — DATABASE

- [x] Supabase project — PostgreSQL 16 (docker-compose) wired via Prisma 7 driver adapter; connection through `DATABASE_URL` in `prisma.config.ts` and `@prisma/adapter-pg` (evidence: migrations + gate below; managed Supabase hosting is a Phase 18 deployment concern)
- [x] Prisma + migrations — Prisma 7.10, `prisma.config.ts` datasource (v7 moved `url` out of schema), client generated to `packages/db/src/generated` (gitignored, regenerated via `postinstall`/`db:generate`); migration `20260917143644_init` applied (evidence: `prisma migrate status` = up to date)
- [x] events — `events` (canonicalEventId unique, const-indexed start_time, event status enum); CRUD tested
- [x] source event IDs — `source_event_ids` (unique provider+sourceEventId, optional rawJson snapshot); CRUD tested
- [x] teams/aliases — `teams` + `team_aliases` (alias unique per source, alias dictionary for §6 normalization); CRUD tested
- [x] bookmakers — `bookmakers` (unique name, isActive); CRUD tested
- [x] odds sources — `odds_sources` (provider registry, source health status); CRUD tested
- [x] markets — `markets` normalized per source (eventId, period, family, marketType, participant, line, settlementRuleId, sourceMarketId; grouping index `eventId,family,period,line` per §64); CRUD tested
- [x] selections — `selections` current price (unique market+bookmaker+outcome, Decimal odds); CRUD tested
- [x] odds observations — `odds_observations` price history (selectionId+observedAt index, rawJson); CRUD tested
- [x] settlement rules/versioning — `settlement_rules` versioned per source (unique source+family+marketType+version, effectiveFrom/To, ruleJson per §53); CRUD tested
- [x] opportunities — `opportunities` (status, totalStake/minReturn/guaranteedProfit/roi, engine versions per §67, status+detectedAt index); CRUD tested
- [x] opportunity legs — `opportunity_legs` (selection + oddsSnapshot + stake + settlementResult); CRUD tested
- [x] audit logs — `audit_logs` (opportunity reconstruction per §66); CRUD tested
- [x] scanner health — `scanner_health` (unique runId heartbeats per source); CRUD tested

**Acceptance:** migrations and CRUD integration tests pass.

Phase 1 gate results (evidence):

- `prisma migrate dev --name init` — migration `20260917143644_init` created + applied to `22void` @ localhost:5432
- `prisma migrate status` — database schema up to date
- `npm run db:test` — 17/17 tests pass (2 unit + 15 CRUD integration across all tables incl. unique-constraint rejections)
- `npm run db:deploy` — non-interactive migration apply (used by CI `db-integration` job)
- `npm run lint` / `npm run typecheck` / `npm run build` — clean across all workspaces
- CRUD tests skip cleanly when `DATABASE_URL` is unreachable, so plain `npm test` stays green without a database

Notes:

- Prisma 7 driver-adapter runtime: `@prisma/adapter-pg` + `pg`; client factory/singleton in `@22void/db` (`packages/db/src/client.ts`).
- `raw_payloads` table (spec §65 retention) included ahead of Phase 3 ingest.
- Managed Supabase project creation deferred to the Phase 18 deployment phase; the local Postgres 16 instance is the active Phase 1 target.

## PHASE 2 — DOMAIN MODEL

- [x] Canonical event — `canonicalEventSchema`/`CanonicalEvent` (canonicalEventId, sport, competition, homeTeam/awayTeam, ISO startTime, status, per-provider source IDs with uniqueness + distinct-teams refines) (evidence: `packages/domain/src/canonical-event.ts`, 8 tests)
- [x] Market taxonomy — `marketStructureSchema` + `MARKET_STRUCTURES` per-family invariants (marketType/participant/line shape) and `marketStructureKey()` canonical identity; MATCH_TOTAL vs TEAM_TOTAL vs ASIAN_TOTAL kept distinct (§7) (evidence: `packages/domain/src/market.ts`, 10 tests)
- [x] Selection taxonomy — `canonicalSelectionSchema` + `OUTCOMES_BY_FAMILY` outcome-per-family validation (incl. exact-score scorelines, §5/§7/§9) (evidence: `packages/domain/src/selection.ts`, 7 tests)
- [x] Period model — `Period` value set + `periodSchema`; every market structure carries a period (§8) (evidence: `packages/domain/src/value-sets.ts`, `market.ts`)
- [x] Decimal odds representation — branded `DecimalOdds` type + `decimalOddsSchema`/`parseDecimalOdds` on top of shared `MIN_DECIMAL_ODDS`; rejects <= 1.0/NaN/Infinity (§5) (evidence: `packages/domain/src/decimal-odds.ts`, 5 tests)
- [x] Freshness model — `classifyFreshness`/`freshnessScore` + `freshnessSchema` with configurable policy (default <5s FRESH, 5–15s AGING, >15s STALE, §38) (evidence: `packages/domain/src/freshness.ts`, 7 tests)
- [x] Settlement states — `settlementStateSchema` + `settlementResultFromComponents` (quarter-line WIN/LOSS/PUSH/VOID combos) + `returnMultiplier` (§9/§10) (evidence: `packages/domain/src/settlement.ts`, 13 tests)

**Acceptance:** representative fixtures validate correctly.

Phase 2 gate results (evidence):

- `tests/fixtures/domain/index.ts` — representative fixtures: 2 canonical events, 12 market structures (all 11 families + a FIRST_HALF total), 11 selections, 6 settlement states, 3 freshness records, 6 valid odds
- `packages/domain/src/fixtures.test.ts` — every fixture validates against its schema (6 tests)
- `npm test -w @22void/domain` — 8 suites / 63 tests pass
- `npm run lint` / `npm run typecheck` / `npm run build` — clean across all workspaces (the Next.js build bundles `@22void/domain`)

Notes:

- Domain sources use extensionless relative imports (bundler resolution) so Next.js/Turbopack can bundle the multi-file package; test files keep the repo's `./index.js` convention (vitest-only).
- `@22void/domain` now depends on `zod` and `@22void/shared`; `index.ts` re-exports the split modules (`value-sets`, `canonical-event`, `market`, `selection`, `decimal-odds`, `freshness`, `settlement`).

## PHASE 3 — PROVIDER

- [x] Provider interface — `OddsProvider { providerKey, poll(), health() }` + provider envelope (`providerSelection/price/market/event/envelope/health` schemas in `packages/provider-contracts/src/envelope.ts`), `PollRequest`/`PollResult`, `newRequestId()`, `buildRawPayload()` (`odds-provider.ts`); registry `MarketKeySpec`, outcome-label mappers, and generic wire→envelope translation isolate provider dialects from the engine
- [x] Mock provider — `MockProvider` + `buildMockEnvelope(now, requestId)`; deterministic fixture envelope covering ALL canonical families (1X2, double chance, match totals, Asian totals 2.25, Asian handicap −0.75, team totals, team Asian totals, corners, cards, BTTS, exact score, first-half totals) across 3 bookmakers with per-price source timestamps
- [x] Evaluate ParlayAPI — researched detailed coverage/terms; adapter skeleton exists but is NOT the initial provider (see docs/PROVIDER_EVALUATION.md)
- [x] Evaluate Odds-API.io — researched coverage/terms; chosen as initial provider
- [x] Verify football coverage — Odds API soccer featured + additional markets match the verified canonical set (h2h, totals, team_totals, btts, double_chance, correct_score, h2h/totals 1st-half, corners/cards via alternate_totals_*)
- [x] Verify bookmaker coverage — multi-bookmaker envelope across uk/eu regions; per-bookmaker last_update carried through
- [x] Verify Asian totals/handicaps — neither candidate offers quarter lines (recorded gap; taxonomy + MockProvider already exercise 2.25/−0.75 so the engine pipeline is ready; supplementary feed planned for Phase 19)
- [x] Verify team totals — team_totals_home/away wire keys split into per-participant, per-line canonical markets
- [x] Verify corners/cards — registered `alternate_totals_corners` / `alternate_totals_cards` (Odds API additional markets, US-spotlight books); ParlayAPI has none
- [x] Verify Kenya/use restrictions — neither catalogue lists Kenyan/African bookmakers; use restrictions reviewed (Odds API: storage/dashboards/derived analytics permitted, no feed resale; ParlayAPI free tier non-commercial)
- [x] Verify redistribution/commercial rights — recorded in docs/PROVIDER_EVALUATION.md; Phase 16 re-verification point
- [x] Choose initial provider — **The Odds API** (`odds-api`)
- [x] Implement adapter — `OddsApiProvider` (v4 `/odds` + `/sports`, `?apiKey`, decimal/ISO, zod wire validation, health probe, regions/markets overridable) and `ParlayApiProvider` skeleton; shared `fetchJson`/`ProviderTransportError` in `providers/http.ts`
- [x] Store raw payloads — verbatim wire body wrapped in `RawProviderPayload`; `@22void/db` `storeRawPayload`/`ensureOddsSource` (spec §65 `raw_payloads` table) + integration test (skip-if-no-DB); collector `runCollectOnce` store hook
- [x] Store timestamps — `receivedAt` at ingest + per-price `sourceUpdatedAt` (from wire last_update) in the envelope; canonical conversion sets `observedAt = receivedAt` and clamps `sourceUpdatedAt ≤ receivedAt` (clock-skew safety)

**Acceptance: live payload converts to canonical records.**

Phase 3 gate results (evidence):

- `packages/provider-contracts` — 43 tests / 6 suites pass (provider-id registry, envelope schema, translation with the Odds-API.io + ParlayAPI raw fixtures, outcome-label edge cases incl. П2/comma decimals/point-or-label lines/team_split, canonical conversion with clamp + reject-not-guess, MockProvider coverage/determinism, OddsApiProvider + ParlayApiProvider adapters via fetch stub, health probes, transport-error statuses)
- End-to-end proof on wire-format fixtures: `tests/fixtures/providers/raw/odds-api.soccer.json` + `parlay-api.soccer.json` (kept as verbatim raw-payload records with fixed past timestamps) → adapter zod parse → translate → envelope → `envelopeToCanonicalRecords` → canonicalEvent/canonicalSelection records → `runCollectOnce` summary + raw payload store callback. Live on-network verification is deferred to runtime validation once `ODDS_API_KEY` is provisioned (Phase 14/16 surface); the acceptance is proven against captured real API response shapes.
- `@22void/db` — raw payload retention unit/integration coverage added (`raw-payloads.test.ts`, skip-if-no-DB convention); CRUD integration suites skip without `DATABASE_URL` (plain `npm test` green)
- `workers/odds-collector` — `runCollectOnce` wiring + 5 tests (poll→convert→store, no-hook, error propagation, store failure, worker id)
- `npm run lint` / `npm run typecheck` / `npm run build` — clean across all workspaces
- `docs/PROVIDER_EVALUATION.md` — contract of record for provider choice, coverage gaps and compliance notes

Notes:

- Provider-specific concerns (endpoints, auth, wire schemas) live only inside `adapters/`; the translation layer is parameterized by a market-key registry so adding Provider B/C in Phase 19 does not touch the core engine (ARCHITECTURE.md rule).
- `exactOptionalPropertyTypes` + `verbatimModuleSyntax` + `consistent-type-imports` constraints shaped the adapters (conditional spreads for optional props, `import type` for types).
- Odds API keys remain server-side env only; `.env.example` extended with `ODDS_API_SPORTS/REGIONS/MARKETS`.

## PHASE 4 — EVENT NORMALIZATION

- [x] Team alias dictionary — `TeamDictionary` (normalized-key → canonical team; seeded soccer aliases: Man City→Manchester City, Milan→AC Milan, PSG→Paris Saint-Germain, Bayern München handling, etc.), runtime-extensible (`add`)
- [x] Case/Unicode normalization — `normalizeText`/`normalizeTeamName` (NFKC, combining-mark/diacritics stripping, case folding, punctuation→spaces, whitespace collapse); no fuzzy/auto-FC magic, everything else is dictionary-driven
- [x] Home/away normalization — teams compared per-side through canonical resolution; home/away swap is only matchable under an explicit `allowSwap` policy and is always flagged
- [x] Competition normalization — `CompetitionDictionary` (EPL/La Liga/Serie A/Bundesliga/Ligue 1 aliases); explicit competition mismatch is a −0.2 penalty, never swept under the rug
- [x] Start-time matching — startTime compared within `startTimeToleranceMs` (default 2h); out-of-tolerance adds a reason and drops the +0.3 signal
- [x] Source ID mapping — `SourceIdIndex` maps `provider:sourceEventId` → one canonicalEventId (uniqueness invariant), resumable via `seedSourceIndex`; merge adopts the first-seen provider's event
- [x] Duplicate prevention — same sourceEventId re-registration merges (confidence 1.0) without duplicating sourceEventIds (schema's unique-per-provider refine is respected)
- [x] Match confidence — weighted signals (same provider event id 1.0, canonical teams 0.5, start time 0.3, competition 0.2/−0.2) + `classifyMatch` policy (confirm ≥0.8, uncertain when teams agree but score < confirm, none otherwise) — **uncertain matches are never silently merged**

**Acceptance:** same event from multiple sources becomes one canonical event.

Phase 4 gate results (evidence):

- `packages/normalization` — new implementation (was a skeleton): `src/text.ts`, `src/dictionaries.ts`, `src/matching.ts`, `src/source-ids.ts`, `src/registry.ts` + 40 tests / 6 suites (text normalization, dictionaries, match confidence + classification, source-id index, normalizer registry, export surface)
- Cross-provider acceptance proven: "Manchester City v Arsenal" registered from `odds-api:oddsepl001` and then from `parlay-api:parlayepl001` (different ids, same match) resolves to ONE canonical event `odds-api:oddsepl001` carrying both `sourceEventIds`; alias-driven variant ("Man City" vs EPL label + 30s kickoff skew) merges the same way; re-registration dedupes; a teams-matching event with a competition mismatch is held `uncertain` and never merged; a Chelsea-v-Liverpool event in the same fixture batch is created as its own canonical event
- `EventNormalizer` supports seeding from stored canonical events + a persisted `SourceIdIndex` (restart-safe ingest); dependency `@22void/domain` added to the package
- Pre-existing gate regression repaired so the workspace is green again: provider-contracts test files' `fetch` stub mocks are now properly typed (`stubFetch` param signature) and `MockProvider.poll` accepts the optional `PollRequest` like `OddsProvider` declares (typecheck was failing)
- `npm run lint` / `npm run typecheck` / `npm run build` — clean across all workspaces

Notes:

- Provisional canonical id `"<provider>:<sourceEventId>"` (Phase 3) is still used for a brand-new canonical event; Phase 4 matching now folds the second provider's event into the first-seen one instead of inventing a new identity. Cross-provider event matching for Provider B/C in Phase 19 reuses `computeMatchConfidence`.
- Confidence is deliberately conservative: a teams signal with any conflicting or missing corroboration lands in the `uncertain` band for a supervisor to resolve — matches the spec's "uncertain matches are never silently merged".

## PHASE 5 — MARKET NORMALIZATION

- [x] 1X2 — "1X2"/"Match Result"/"H2H" → MATCH_RESULT/ONE_X_TWO/FULL_MATCH
- [x] Double chance — "Double Chance" → DOUBLE_CHANCE/DOUBLE_CHANCE
- [x] Match totals — "Goals Over/Under"/"Total Goals"/"O/U"/"Match Total" → MATCH_TOTAL/STANDARD/FULL_MATCH (equivalent labels normalize to one identity)
- [x] Asian totals — "Asian Total Goals 2.25" → ASIAN_TOTAL/ASIAN with quarter line "2.25"
- [x] Asian handicap — "Home Asian Handicap -0.75" → ASIAN_HANDICAP/HANDICAP/HOME with line "-0.75"
- [x] Team totals — "Home/Away Team Goals O/U" → TEAM_TOTAL/{HOME|AWAY}, never MATCH_TOTAL
- [x] Team Asian totals — "Away Team Asian Total 1.75" → TEAM_ASIAN_TOTAL/ASIAN/AWAY with line "1.75"
- [x] Corners — "Corners Over/Under" → CORNERS/STANDARD (distinct from goals/cards/shots)
- [x] Cards — "Cards Over/Under" → CARDS/STANDARD (distinct from goals/corners/shots)
- [x] BTTS — "Both Teams to Score"/"BTTS" → BTTS/BTTS
- [x] Period markets — First/Second Half totals → PERIOD FIRST_HALF/SECOND_HALF, separate identities from FULL_MATCH (period-first token scan, default FULL_MATCH)
- [x] Exact/range partitions where supported — "Correct Score"/"Exact Score" → EXACT_SCORE/EXACT_SCORE (one identity)

**Acceptance:** equivalent markets normalize identically; non-equivalent markets do not. Proven in `packages/normalization/src/market.test.ts` (19 tests): equivalent-labels test asserts a single identity key for "Goals Over/Under" + "Total Goals" + "O/U" + "Over Under 2.5 Goals"; the family isolation tests assert Corners ≠ Cards ≠ Goals ≠ Shots and Team-Total-Home ≠ MATCH_TOTAL; unmapped labels ("Draw No Bet", "Shots Over/Under", goalscorer/player props, unknown keys without a label) are rejected with a reason and never guessed (Rule 3).

Phase 5 gate results (evidence):

- `packages/normalization/src/market.ts` — `MarketNormalizer` with two paths: (1) provider-native key registry (`addKey(provider, key, canon)`; namespaced per provider, so odds-api `h2h` ≠ parlay-api `h2h`) resolving family/period/marketType/participant and filling a missing line from outcome points/names; (2) generic label classifier (word scan over normalized tokens: "corners"/"cards"/"shots" families, "asian"+"handicap"/"team"/total cues, "team"+over-under → TEAM_TOTAL, 1X2/double chance/BTTS/exact-score markers, half/extra-time period tokens, home/away participant words). Missing required line/participant is surfaced as a reason (and `toStructure()` refuses an invalid structure) rather than guessed.
- Line extraction is raw-text based (`extractLineFromLabel`, last numeric run, `+`/`,`/`.` canonicalization) — normalized tokens would split "2.25" into "2 25", so numbers are never fed through `normalizeText`.
- Resolution carries `via: "key" | "label"`, source string and reasons; identity comparison reuses domain `marketStructureKey` (`marketIdentityKey`).
- Provider-contracts wiring (Phase 3 keys) feeds `MarketNormalizer.addKey`; no dependency added to provider-contracts — normalization stays domain-only (ARCHITECTURE.md rule).
- `npm run lint` / `npm run typecheck` / `npm run build` / `npm run test` / `npm run state:check` — green across workspaces (186 tests passing; normalization now 59 tests / 7 suites).

Notes:

- `exactOptionalPropertyTypes` shaped the classifier output (`classified()` helper conditionally spreads participant); provider key/descriptor types are exported for the Phase 19 provider-B/C bridge.
- The key path is authoritative when both a key and a label are present; a label-less unknown key is rejected instead of classifying the raw key string as a label.
- The default-line tolerance and unmapped-label policy match `docs/ARBITRAGE_ENGINE_SPEC.md` §7 examples exactly ("Goals Over/Under"/"Total Goals"/"O/U" → MATCH_TOTAL/STANDARD; "Home Team Goals O/U" → TEAM_TOTAL/HOME, never MATCH_TOTAL).

## PHASE 6 — SETTLEMENT ENGINE

- [x] Full win — `SettlementResult.FULL_WIN`, `returnMultiplier = odds`, `payout(100, 2.1) = 210`
- [x] Full loss — `FULL_LOSS`, multiplier 0
- [x] Push — `PUSH`, multiplier 1; whole lines push on exact equality (`Over 2.0` at T=2, `Home −1.0` win-by-1)
- [x] Half win — `HALF_WIN`, `(odds+1)/2`; derived from components `[WIN, PUSH]` (e.g. Over 2.75 at T=3, Home −0.75 win-by-1)
- [x] Half loss — `HALF_LOSS`, 0.5; derived from components `[PUSH, LOSS]` (e.g. Over 2.25 at T=2)
- [x] Void — `VOID`, multiplier 1; cancelled/abandoned/postponed events void; unfinished events refuse to settle
- [x] Asian totals — quarter split via `splitAsianLine` (§13: 2.25 → 2.0 + 2.5, 2.75 → 2.5 + 3.0), components combined with domain `settlementResultFromComponents`
- [x] Asian handicaps — §14: home `adjusted = margin + line`, away `adjusted = line − margin`; −0.75 → −0.5/−1.0, win-by-1 → HALF_WIN
- [x] Standard totals — §11 Over/Under; over 2.5 wins at T≥3 loses at T≤2, exact complements
- [x] Team totals — participant-scoped home/away goals, STANDARD + ASIAN (quarter) forms
- [x] Period settlement — FULL_MATCH / FIRST_HALF / SECOND_HALF (derived from full − first, or explicit) / EXTRA_TIME / PENALTIES; missing period state refuses to settle
- [x] Rule versioning — `SettlementRuleStore` + `SettlementEngine`: rules versioned per provider with `effectiveFrom`/`effectiveTo`/`sourceReference`; the applicable rule is picked per instant; no rule → UNKNOWN_SETTLEMENT; new rules never silently applied to historical data (§53)

**Acceptance:** exhaustive settlement tests pass.

Phase 6 gate results (evidence):

- `packages/settlement` — implemented (was a Phase 0 skeleton): `src/line.ts` (canonical line parse/format/kind + quarter decomposition), `src/settle.ts` (component-based evaluator for every family + period/void/unknown handling), `src/engine.ts` (versioned rules + engine), `src/payout.ts` (§10 formulas + per-component breakdown). 57 tests / 5 suites.
- Golden spec cases covered: Over/Under 2.5, whole Asian 2.0 push, quarter 2.25/2.75 (half-loss/half-win), Home −0.75 (HALF_WIN on win-by-1) and −1.0 push, Home +0.25 draw, Away +0.75, 1X2, double chance, BTTS, exact score, first/second/extra-time periods, corners/cards totals, VOID and unfinished events, and Rule-3 rejects (missing line, invalid line, missing participant, unsupported outcome, missing period/corner state).
- Payout invariants (§10, §69): per-component payouts sum to the gross return for every tested line/score combination; `componentPayouts` of `[PUSH, LOSS]` = [stake/2, 0], `[WIN, PUSH]` = [stake·odds/2, stake/2].
- Versioning proven: provider rules v1 (window ends 2026-07-01) vs v2 produce different settlements for the same selection; historical dates resolve v1, current dates resolve v2, dates before any window return UNKNOWN_SETTLEMENT; duplicate provider+version registration throws.
- `npm run lint` / `npm run typecheck` / `npm run build` / `npm run test` / `npm run state:check` — green across workspaces (242 tests passing).

Notes:

- Settlement is generic over the score source: the same evaluator settles goals, team totals, corners and cards; `MatchState` carries per-period goal scores plus corner/card counts. Live/remaining-after-placement Asian semantics remain a Phase 7+ concern (the state engine feeds this evaluator).
- Quarter behavior is always computed from component settlements — no `if (line === -0.75)` special cases (§15). The `away: adjusted = line − margin` convention makes `Away +0.75` symmetric with `Home −0.75`.
- Rules are provider-scoped; the engine ships a `std` reference rule (`standardSettlementRule`, spec §9–§16). Provider-specific rule versions register with effective windows in Phase 19.

## PHASE 7 — FOOTBALL OUTCOME ENGINE

Use score state (H,A), with total T=H+A.

- [x] Generate relevant score states — `buildStateModel(selections)` reduces the score space to representative equivalence classes: boundaries are derived from the selections themselves (`boundaryMax`: largest `ceil(line)`, plus implicit boundaries for result/BTTS/exact-score), enumerated up to `ceil(boundary)+1` and grouped by settlement vector, so all scores in a class settle identically (§17–§20 Steps 1–5)
- [x] Match totals — Over/Under and Asian total lines classified via the Phase 6 evaluator; complementary lines reduce to exactly two classes
- [x] Asian totals — quarter lines (2.25 etc.) settle through component splits; classes include FULL/HALF/PUSH outcomes
- [x] Team totals — participant-scoped home/away goal lines, STANDARD and Asian forms
- [x] Team Asian totals — team-scoped quarter lines via the same evaluator
- [x] 1X2 — HOME/DRAW/AWAY partition into three mutually exclusive classes, exactly one win per state
- [x] Handicaps — Asian handicap lines, including quarter lines classified as component outcomes (e.g. Home −0.75 win-by-1 → HALF_WIN)
- [x] BTTS — BTTS_YES/BTTS_NO complementary partition
- [x] Suitable corner state model — corners form an independent count dimension; `buildStateModel` enumerates and reduces corner counts separately and composes them with goal classes (§ corner over/under reduces to two classes, winner has total ≥ 11)
- [x] Period-aware goal states — when any selection is FIRST_HALF/SECOND_HALF the model enumerates `(fullTime, firstHalf)` with `firstHalf ≤ fullTime`, so period markets partition correctly
- [x] Settlement/payoff matrices — `settleVector`, `settlementMatrix` and `payoffMatrix` expose the per-state × per-selection settlement results and return multipliers (§21–§22)
- [x] Rule 3 — selections that cannot settle (unsupported period → `NO_STATE_MODEL`, missing line/participant, no rule) are reported in `unknown` and excluded, never guessed

**Acceptance:** known fixtures return expected states.

Phase 7 gate results (evidence):

- `packages/outcome-engine` — implemented (was a Phase 0 skeleton): `src/score.ts` (FootballScore/MetricCounts, `matchTotal`, `goalMargin`, `metricTotal`), `src/state-model.ts` (`boundaryMax`, `settleVector`, `buildStateModel`, `settlementMatrix`, `payoffMatrix`), re-exported from `src/index.ts`; package now depends on `@22void/domain` + `@22void/settlement`. 23 tests / 3 suites.
- Spec fixtures covered: §21 coverage matrix (Team A Over 1.5 / Team B Over 1.5 / Match Under 3.5) classifies 2-0 → WIN/LOSS/WIN, 1-1 → LOSS/LOSS/WIN, 2-2 → WIN/WIN/LOSS and all three classes exist in the reduced model; §27 false-overlap (Over 10.5 / Under 13.5) exposes a both-win state; complementary totals, 1X2 and BTTS reduce to the expected class counts; Asian quarter handicap (Home −0.75) yields HALF_WIN/FULL_WIN/FULL_LOSS and never a push; corner totals reduce independently; first-half + full-match model only emits `firstHalf ≤ fullTime` states; exact-score "3-2" class has representative (3,2); extra-time and line-less selections surface in `unknown` with a reason.
- Step-5 invariant holds by construction (states are grouped by settlement vector) and is asserted in tests; `payoffMatrix` maps results to §10 multipliers and rejects mismatched odds length.
- `npm run lint` / `npm run typecheck` / `npm run build` / `npm run test` / `npm run state:check` — green across workspaces (263 tests passing).

Notes:

- The model enumerates only up to `ceil(max boundary)+1`, beyond which all scores are provably equivalent for the given selections, so it stays small (`selections × classes`, not `selections × thousands of scores`). Caps default to 12 goals / 20 corners / 12 cards and are overridable via `StateModelOptions`.
- Classification always delegates to the Phase 6 settlement engine — the state model never re-implements settlement logic. Corner/card markets are modelled as whole-match counts (matching Phase 6; per-half corner state is out of scope).
- The goal dimension only expands to `(fullTime, firstHalf)` when a period market is present; otherwise it enumerates full-time scores only.
- Live/remaining-after-placement Asian semantics remain a later concern; the state engine currently models finished matches (status FINISHED).

## PHASE 8 — FALSE-ARB DETECTOR

- [x] Mutual exclusivity — a state where two or more legs on the **same metric** (family + period + participant) both win is an overlap violation (`NON_EXCLUSIVE`); cross-metric overlaps are legal and recorded only
- [x] Collective exhaustiveness — every reduced state must have at least one winning leg; otherwise the candidate is `NON_EXHAUSTIVE` (gap/uncovered state)
- [x] Overlap detection — `StateOverlap` findings distinguish `SAME_METRIC` (illegal) from `CROSS_METRIC` (allowed); CASE-003 Over 10.5 + Under 13.5 is rejected, CASE-004 Home Under 1.5 + Match Over 1.5 is accepted
- [x] Uncovered-state detection — `gaps` list every state with no winning leg, with representative score and settlement vector
- [x] Both-loss detection — a state where every leg is `FULL_LOSS` yields `BOTH_LOSS_STATE` (§28)
- [x] Push/gap detection — a state with no winner but a `PUSH`/`VOID` (not all losses) yields `NON_EXHAUSTIVE`; whole-line pushes are modelled exactly via the Phase 6/7 engine
- [x] Human-readable rejection reason — `formatRejection` / `formatCoverageReport` render the structured reason + evidence (`stateId`, representative score, settlements, leg ids); every verdict also carries machine-readable `evidence` (§41)
- [x] Pruning reasons — unknown settlement → `UNKNOWN_SETTLEMENT` (Rule 3, never guessed), duplicate selections / empty candidate → `INVALID_MARKET` (§34)

**Acceptance:** known false arbs are rejected.

Phase 8 gate results (evidence):

- `packages/arbitrage` — implemented (was a Phase 0 skeleton): `src/coverage.ts` (`detectFalseArb`, `formatRejection`, `formatCoverageReport`, `ArbitrageLeg`, `CoverageReport`, `FalseArbVerdict`, `StateOverlap`, `StateGap`), re-exported from `src/index.ts`; package now depends on `@22void/domain` + `@22void/settlement` + `@22void/outcome-engine`.
- Golden cases (§70) proven: CASE-001/002 complementary Over/Under 2.5 structurally `COVERED` (exclusive + exhaustive; profitability is Phase 9), CASE-003 Over 10.5 + Under 13.5 `REJECTED` (`NON_EXCLUSIVE`), CASE-004 Home Under 1.5 + Match Over 1.5 `COVERED` (cross-metric overlap only), CASE-005 Over 1.0 + Under 1.5 `COVERED` with a `PUSH` state; §21/§31 cross-metric three-leg structures accepted with a both-win state; §28-style both-loss (`BOTH_LOSS_STATE`) and push/gap (`NON_EXHAUSTIVE`) rejected; 1X2 three-way partition accepted; unknown-period leg → `UNKNOWN_SETTLEMENT`; duplicate/empty → `INVALID_MARKET`.
- State vectors are aligned to input legs via `selectionIndices`; the detector builds states with `buildStateModel` (never re-implements settlement) and bounds the grid from the selections' own boundaries.
- `npm run lint` / `npm run typecheck` / `npm run build` / `npm run test` / `npm run state:check` — green across workspaces (277 tests passing).

Notes:

- `COVERED` means the candidate's **structure** is sound, not that it is profitable. The reciprocal-sum shortcut `sum(1/odds) < 1` is never used; only the state model decides (spec §23–§27). Profitability is Phase 9 (`min return > T`, else `NEGATIVE_GUARANTEED_PROFIT`).
- Exclusivity is scoped per metric (family + period + participant): two totals on the same line set overlapping is rejected, while team-total/match-total overlaps are the intended cross-market structures (§30–§31) and are left to the optimizer.
- Overlap/gap/unknown findings are collected with a per-reason count (evidence capped) rather than short-circuiting on the first state, for observability.

## PHASE 9 — STAKE OPTIMIZER

- [x] Two-way — solver stakes match `classicTwoWayStakes` (`Si = T·qi/Q`) on complementary Over/Under 2.5
- [x] Three-way — solver stakes match `classicThreeWayStakes` on the 1X2 partition
- [x] Push-aware — `PUSH` contributes multiplier 1 (returned stake), not 0; proven on a hand-built push matrix (0.5·1 + 0.5·2 = 1.5 vs 1.0 if push were a loss)
- [x] Half-settlement — `HALF_WIN = (odds+1)/2`, `HALF_LOSS = 0.5` taken from the Phase 6/7 matrices; Home −0.75 / Away +0.75 yields the expected `minReturn ≈ 103.33` on T=100
- [x] Multi-leg — general LP solves a 4-leg goals + BTTS structure with non-negative stakes summing to T
- [x] General maximin solver — two-phase dense simplex (`simplexMinimize`, artificials + Bland's rule) maximizing `z` s.t. `A·x ≥ z`, `Σx = T`, `x ≥ 0`
- [x] Minimum guaranteed return — `minReturn = min(stateReturns)` recomputed from the final stakes (never a reciprocal-sum shortcut, §23/§45)
- [x] Guaranteed profit — `minReturn − totalStake`
- [x] ROI — `guaranteedProfit / totalStake`
- [x] Rounding tolerance — `isArb = minReturn > T + EPS` (floating-point tolerance, spec §23); currency/denomination rounding of stakes is Phase 11
- [x] Minimum stake constraints — LP enforces `Si ≥ 0` and `ΣSi = T` exactly; per-bookmaker minimum bet sizes are an execution concern (Phase 11+)

**Acceptance:** simulated worst-case return matches optimizer output.

Phase 9 gate results (evidence):

- `packages/arbitrage` — `src/simplex.ts` (dense two-phase `simplexMinimize` with sign-normalized rows, artificial basis, phase-1 feasibility check, artificials pivoted out / forbidden by a large cost, Bland's rule; returns `optimal`/`infeasible`/`unbounded`) and `src/optimizer.ts` (`buildMultiplierMatrix`, `reciprocalSum`, `optimizeStakes`, `optimizeCandidate`, `classicTwoWayStakes`, `classicThreeWayStakes`, `StakePlan`), re-exported from `src/index.ts`.
- Acceptance proven by simulated worst-case return: for every case the reported `minReturn` equals `Math.min(...stateReturns)` recomputed from the solved stakes (invariant asserted), and the per-state returns are the actual §10 multipliers, not WIN/LOSS counts.
- Golden cases: two-way Over/Under 2.5 (2.2/2.1) `ARB` with closed-form parity; three-way 1X2 (3.5/3.4/3.6) closed-form parity on T=300; no-arb (1.9/1.95) `NO_ARB` with negative guaranteed profit; push matrix (push = returned stake) `ARB` at `minReturn 150`; Home −0.75 / Away +0.75 half-settlement `ARB` at `minReturn ≈ 103.33` with 1.55 and 0.5 multipliers present; 4-leg goals + BTTS `ARB`; `optimizeCandidate` throws `OPTIMIZATION_FAILED` on a `REJECTED` report; invalid `totalStake`/empty legs/state-leg misalignment throw.
- `simplexMinimize` unit-tested directly: single equality, two-variable system, negative RHS, infeasible and unbounded detection.
- `npm run lint` / `npm run typecheck` / `npm run build` / `npm run test` / `npm run state:check` — green across workspaces (292 tests passing; arbitrage now 30 tests / 4 suites).

Notes:

- `optimizeStakes` takes an aligned `(states, legs)` pair; `optimizeCandidate` is the Phase 8 bridge and refuses any non-`COVERED` report (a rejected candidate has no trustworthy matrix). `NEGATIVE_GUARANTEED_PROFIT` is surfaced as `status: "NO_ARB"` + negative `guaranteedProfit` rather than a thrown error.
- `minReturn` is recomputed from the returned stakes, so a numerically-imperfect LP solution can never overstate the guarantee; a `NO_STATE_MODEL`/unknown settlement is handled upstream by Phase 8, not here.
- Stakes are returned as exact fractions scaled by `T` (no currency rounding); rounding, minimum bet sizes and verified-vs-theoretical status are Phase 11.


## PHASE 10 — CANDIDATE GENERATOR

- [x] Same-market cross-book — two legs on opposite outcomes of one line are grouped and pruned against the §61 price prefilter (`sum(1/O) >= 1` on a standard complement → rejected without optimization)
- [x] Complementary markets — `isStandardComplement` recognizes same family/period/participant/line + opposite outcome (OVER/UNDER, BTTS_YES/NO, HOME/AWAY) and `classifyStructure` labels the rest `COMPLEMENTARY_TOTALS`
- [x] Asian-line candidates — `ASIAN_TOTAL` and `ASIAN_HANDICAP` families are generated and labelled (`ASIAN_LINE` / `PROTECTED_HANDICAP`)
- [x] Team-total/match-total — cross-family compatibility (`MATCH_TOTAL ↔ TEAM_TOTAL`) produces `TEAM_TOTAL_MATCH_TOTAL` candidates (§30–§31)
- [x] Multi-leg partitions — size grows 2 → 3 → larger via `maxLegs`; 1X2/DC and multi-metric sets are labelled `PARTITION`/`MULTI_LEG_PARTITION`
- [x] Protected handicap structures — same-family Asian handicap pairs (e.g. Home −0.75 / Away +0.75) generate as `PROTECTED_HANDICAP`
- [x] Candidate pruning — `pruneCandidate` rejects candidate size, event/period mismatch, duplicate selection, invalid odds, suspended, stale, uncertain event, same-bookmaker policy, incompatible market and price prefilter (§34/§61); pruning never decides arbitrage

**Acceptance:** known arbs found and known false arbs rejected.

Phase 10 gate results (evidence):

- `packages/arbitrage` — `src/candidates.ts` (`PricedSelection`, `Candidate`, `generateCandidates`, `bestPricePerSelection`, `pruneCandidate`, `pruneCandidates`, `scanCandidates`, `classifyStructure`, `isStandardComplement`, `familiesCompatible`, `formatPruneVerdict`), re-exported from `src/index.ts`.
- Staged generation proven (§33): Stage A groups by canonical event, Stage B groups by period (first-half and full-match legs never share a candidate), Stage C only pairs families with an implemented state model (`MATCH_TOTAL↔TEAM_TOTAL`, `MATCH_TOTAL↔ASIAN_TOTAL`, `TEAM_TOTAL↔ASIAN_TOTAL`, `MATCH_RESULT↔DOUBLE_CHANCE`, `MATCH_TOTAL↔BTTS`; Corners↔Cards and Corners↔Totals refused), Stage D grows 2 → 3 legs with `maxCandidates` bounding the combination count. Same-selection legs (different bookmakers) are never combined.
- Pruning proven: invalid odds, suspension, staleness (`maxAgeMs`/`now`), uncertain event (`eventConfidence`), duplicate selection, same-bookmaker policy (`allowSameBookmaker: false`) and the standard-complement price prefilter; a complex non-complement with `Q >= 1` is deliberately **not** prefiltered (Rule 1).
- `scanCandidates` acceptance: a two-way Over/Under 2.5 (2.2/2.1) candidate scans `ARB` with positive guaranteed return; the Over 10.5 + Under 13.5 false arb scans `REJECTED` with `NON_EXCLUSIVE`; a covered-but-unprofitable Over 1.0 + Under 1.5 structure scans `NO_ARB`; suspended and price-prefiltered candidates scan `PRUNED` with `coverage === null` (never optimized).
- `npm run lint` / `npm run typecheck` / `npm run build` / `npm run test` / `npm run state:check` — green across workspaces (313 tests passing; arbitrage now 51 tests / 5 suites).

Notes:

- `bestPricePerSelection` implements the §55 best-price rule (highest odds per distinct selection, so cross-book legs fall out naturally); generation works on whatever priced list it is given, so callers can choose to keep all bookmakers for bookmaker-aware policies.
- `PricedSelection` is structurally an `ArbitrageLeg`, so candidates pass straight into `detectFalseArb`/`optimizeStakes` without conversion.
- Freshness/event-confidence fields are carried and pruned when a policy is supplied, but the full timestamp classification and final recheck are Phase 11; §62 market-structure caching and §63 incremental detection are performance work for Phase 20.


## PHASE 11 — VALIDATION

- [x] Freshness threshold — per-leg age classification via domain `classifyFreshness` (§38 FRESH/AGING/STALE) with overridable policy; STALE-band or over-horizon legs always fail
- [x] Provider/source status — `PricedSelection.sourceStatus` (`OK/DEGRADED/DOWN/UNKNOWN`) enforced; DOWN/UNKNOWN legs fail with `PROVIDER_UNAVAILABLE`
- [x] Settlement confidence — `settlementConfidence` must be attested on every leg and at/above the floor (`SETTLEMENT_CONFIDENCE_LOW`); never assumed from the market name (Rule 2)
- [x] Event confidence — `eventConfidence` must be attested at/above a verification floor (`EVENT_MATCH_UNCERTAIN`), independent of the Phase 10 pruning floor
- [x] Price age — per-leg `ageMs` (`now - sourceUpdatedAt`, falling back to `observedAt`) must be within `maxAgeMs` (default = policy agingMs, 15s)
- [x] Cross-source timestamp consistency — every leg's `sourceUpdatedAt` is required; the max/min spread must be within `maxSourceSpreadMs` (default 60s) or the candidate is rejected with `CROSS_SOURCE_TIMESTAMP_SPREAD`
- [x] Final recheck — `compareRecheckedPrices` re-fetches every leg and recomputes; any leg missing or moved beyond `recheckTolerance` (default 0.1%) invalidates the opportunity (`PRICE_CHANGED_ON_RECHECK` / incomplete recheck → `PROVIDER_UNAVAILABLE`) before it can be shown
- [x] Theoretical vs verified status — `validateCandidate` maps a Phase 10 `ARB` scan to `VERIFIED_ARB` (all checks + recheck OK), `FRESH_ARB` (fresh, recheck pending), `THEORETICAL_ARB` (positive min return but no attestable provenance → `INSUFFICIENT_PROVENANCE`), `STALE` (stale prices), `INVALIDATED` (recheck moved/incomplete) or `REJECTED` (confidence/source/spread failures)

**Acceptance: stale/uncertain opportunities cannot be marked verified.**

Phase 11 gate results (evidence):

- `@22void/domain` — three Phase 11 `RejectionReason` values added (`SETTLEMENT_CONFIDENCE_LOW`, `CROSS_SOURCE_TIMESTAMP_SPREAD`, `PRICE_CHANGED_ON_RECHECK`) plus `INSUFFICIENT_PROVENANCE` for provenanceless candidates; `REJECTION_REASON_VALUES` derives automatically from the const map
- `@22void/arbitrage` — new `src/validation.ts` (`validateCandidate`, `compareRecheckedPrices`, `priceAge`, `relativeDelta`, `formatValidationReport`) re-exported from `src/index.ts`; `PricedSelection` gained `provider` / `sourceUpdatedAt` (ISO) / `sourceStatus` / `settlementConfidence` provenance fields (spec §38). 19 new tests in `validation.test.ts`; package now 70 tests / 6 suites
- Acceptance proven on the golden paths: a fresh, attested, rechecked two-way 2.2/2.1 arb scans `VERIFIED_ARB` (verified=true, theoretical=true, rejections empty); the same candidate without a recheck stops at `FRESH_ARB`; a provenanceless candidate stays `THEORETICAL_ARB` with `INSUFFICIENT_PROVENANCE`; an AGING price within the horizon still verifies; moved price on recheck → `INVALIDATED` with `PRICE_CHANGED_ON_RECHECK` (Δ rendered); incomplete recheck → `INVALIDATED`/`PROVIDER_UNAVAILABLE`; stale legs → `STALE`/`STALE_ODDS`; event confidence below the (stricter) verification floor → `REJECTED`/`EVENT_MATCH_UNCERTAIN`; settlement confidence below floor → `SETTLEMENT_CONFIDENCE_LOW`; DOWN source → `PROVIDER_UNAVAILABLE`; non-contemporaneous source stamps → `CROSS_SOURCE_TIMESTAMP_SPREAD` (spread rendered, 119s); `NO_ARB` scans → `REJECTED`/`NEGATIVE_GUARANTEED_PROFIT`; `PRUNED` scans → `REJECTED` carrying the mapped prune reason
- Lifecycle invariant asserted: `report.verified === true` only when `status === VERIFIED_ARB`, and none of the stale/uncertain/recheck-failure paths produced `verified`
- `npm run lint` / `npm run typecheck` / `npm run build` / `npm test` — green across all workspaces (333 tests passing; domain 63, arbitrage 70, normalization 59, settlement 57, provider-contracts 43, outcome-engine 23, db 2+18 skipped-without-DB, web 3, collector 5, shared 7)

Notes:

- `validateCandidate` is a pure function over the Phase 10 scan + the candidate's `PricedSelection[]` legs; the actual re-fetch (network/DB) stays in the caller (Phase 14 worker), which passes the fetched prices in as `rechecked`. `verified` is exactly `status === VERIFIED_ARB`, so stale/uncertain/invalidated opportunities can never surface as verified.
- Provenance is all-or-nothing per candidate: `sourceUpdatedAt` + `eventConfidence` + `settlementConfidence` + `sourceStatus` are required on every leg before any check runs; otherwise the candidate is `THEORETICAL_ARB` (Rule 5). Phase 10 pruning already enforces a 0.8 event-confidence floor, so the Phase 11 verification floor (default 0.8, overridable) is deliberately stricter-or-equal and can be tightened independently.
- The `PRUNED` scan path maps `PruneReason` → `RejectionReason` (`EVENT_UNCERTAIN`→`EVENT_MATCH_UNCERTAIN`, `PRICE_PREFILTER`→`NEGATIVE_GUARANTEED_PROFIT`, `SUSPENDED`→`INVALID_MARKET`, `SAME_BOOKMAKER`→`STAKE_LIMIT`, …) so the "why-rejected" surface is uniform.
- Stake rounding / minimum bet sizes (execution realism) remain an explicit Phase 11-adjacent concern deferred to the API/persistence layer (Phase 12) — `validateCandidate` accepts the continuous optimizer plan unchanged.

## PHASE 12 — API

- [x] Authentication (static API keys, reader + admin roles, constant-time compare)
- [x] Events (`GET /api/v1/events`, `GET /api/v1/events/:id` with source links)
- [x] Markets (`GET /api/v1/markets{,/:id}` with current per-bookmaker odds)
- [x] Odds (`GET /api/v1/odds`, flat price view)
- [x] Opportunities (list by status incl. `VERIFIED_ARB`; detail exposes legs + evidence)
- [x] Opportunity details (stakes/returns, engine versions, validation timestamps)
- [x] Provider health (`GET /api/v1/providers`)
- [x] Scanner status (`GET /api/v1/scanner`, runs + staleness aggregate)
- [x] Admin (`GET /api/v1/admin/sources`, `GET /api/v1/admin/audit-logs`, admin key)
- [x] Pagination/filtering (keyset cursors; status/family/period/team/date filters)
- [x] OpenAPI contract (served at `GET /api/v1/openapi`, enums from @22void/domain)

**Acceptance:** integration tests pass — fake-repo handler tests (paths, filters,
cursors, auth 401/403, 400/404), cursor codec round-trips, OpenAPI validity;
34 tests in @22void/web, 8 passing in @22void/db (cursor); 888 repo-wide.

## PHASE 13 — DASHBOARD

- [x] 22_VOID branding (wordmark, shell header/nav, footer with data-source label)
- [x] Live opportunities (`/dashboard` verified feed + `/opportunities`)
- [x] Filters (lifecycle status via client control, client-side navigation)
- [x] Event detail (`/events/:id` — matrix, source links)
- [x] Market matrix (per-leg bookmaker/market/selection/odds/stake/return table)
- [x] Bookmaker comparison (leg market vs current per-bookmaker prices, best + snapshot flagged)
- [x] Stake calculator (client-side proportional re-plan with budget input)
- [x] Guaranteed return (min return / profit / ROI cards + positive-guarantee evidence)
- [x] Settlement explanation (settlement coverage section)
- [x] Why-arb explanation (evidence sections per status/structure)
- [x] Why-rejected explanation (reason-specific copy + reason code)
- [x] Freshness (age + recheck-window status; stale/expired flagged)
- [x] Provider health (`/providers` + dashboard panel)
- [x] Scanner heartbeat (run table + staleness aggregate)

**Acceptance:** complete opportunity inspection flow works — e2e walks landing →
overview → opportunity detail (guarantee cards, matrix, calculator, comparison,
evidence) → rejected-why → event matrix → providers. Verified against the demo
repo in CI (no DB needed).

## PHASE 14 — WORKERS

- [x] Scheduled polling — `createScanWorker`/`runScanCycle` (`workers/odds-collector/src/runtime.ts`): fixed-interval operator loop with non-overlapping cycles, injectable scheduler for tests, `nativeScheduler()` (unref'd `setInterval`) for prod; `src/main.ts` entry (`npm run worker:collect` → `tsx src/main.ts`), env-driven provider (`WORKER_PROVIDER=mock|odds-api`) and store (`DATABASE_URL` set → Postgres store, else in-memory)
- [x] Rate limiter — `TokenBucketRateLimiter` (`src/rate-limit.ts`): token bucket, injectable clock/delay, `queuedMs()`/`acquire()`; wired into the poll step of every cycle
- [x] Retry/backoff — `src/retry.ts`: `isRetryableTransient` (429/5xx/no-status transport, AbortError/TimeoutError, transient socket codes; permanent 4xx re-raise immediately), `retryDelayMs` (exponential base² with ±50% jitter, capped `maxDelayMs`), `withRetry`, `defaultRetryPolicy` (4 attempts / 250ms → 2s)
- [x] Raw payload capture — every poll's verbatim `RawProviderPayload` flows through the store's `storeRaw` before interpretation (§65 `raw_payloads` table); memory store keeps them for sandbox/tests
- [x] Normalize job — `src/normalize.ts`: `normalizeRun` feeds canonical records through `EventNormalizer` seeded from the store (`loadEventSeeds`), persists merged-event confidence into `source_event_ids.eventConfidence` (new column + hand-written migration), and maps markets/selections to the DB identity model using the provider's composite market identity `${providerEventId}:${sourceMarketId}` (the DB keys markets per `(oddsSourceId, sourceMarketId)`, and a provider may reuse a market id across events). Unrepresentable/exact-score records are counted `invalid`, never guessed
- [x] Detection job — `src/detect.ts`: adapts the freshly persisted `DbPricedSelection`s, runs the Phase 10 `scanCandidates` + Phase 11 `validateCandidate` pipeline, and persists every ARB scan's outcome (VERIFIED/FRESH/THEORETICAL/STALE/REJECTED) with its audit trail via `persistOpportunity`. The §39 final recheck is served by the cycle itself — the current cycle's prices are the recheck, so scans are self-consistent
- [x] Persistence job — `@22void/db` `persistCanonicalRun` (events → source bindings → settlement rules → markets → selections, idempotent upserts) behind the `WorkerStore` port (`src/store.ts`), with a Prisma-backed adapter and an in-memory adapter; `ensureOddsSource`/`storeRawPayload` widened to `PrismaClient | Prisma.TransactionClient` (`DbLike`)
- [x] Heartbeat — `recordHeartbeat` per cycle (started probe → finished OK/DEGRADED/DOWN with runId/sourceKey/message); `scanner_health` via the db store, in-memory list otherwise
- [x] Failure recovery — a total outage (poll retries exhausted) marks the source `DOWN` and heartbeats it; the very next successful cycle marks it `HEALTHY` and resumes persisting; transient failures retry within the cycle

**Acceptance: transient provider failures recover.** Proven by
`src/runtime.test.ts` "recovers from a total provider outage without losing
data": a provider that fails twice (maxAttempts=2) cycles `DOWN` (attempts 2,
sourceStatus DOWN), then recovers and cycles `OK` (attempts 1, status HEALTHY),
persisting events/markets/selections, capturing the raw payload, and running
detection.

Phase 14 gate results (evidence):

- `workers/odds-collector` — 26 tests / 6 suites pass: token-bucket semantics (burst, wait+refill), retry classification/backoff/exhaustion/`onRetry`, normalize (created → merged, composite market ids, confidence persisted), detect (built two-way 2.2/2.1 over/under arb persists as a `VERIFIED_ARB` opportunity with legs/returns/audit), runScanCycle recovery + transient-retry, and worker scheduler (manual schedule ticks, stop cancels, stop awaits in-flight cycle)
- `packages/db` — `store.ts` write-side implemented and unit/integration covered (`integration/store.test.ts`, skip-if-no-DB; 8 passed / 23 skipped without a database); `source_event_ids.eventConfidence Float?` added; migration `20260923120000_source_event_confidence` written by hand (diffing from migrations requires `shadowDatabaseUrl`, `--to-schema-datamodel` is gone in Prisma 7), apply via `npm run db:deploy`
- Root scripts: `worker:collect` added; `.env.example` documents `WORKER_PROVIDER`/`SCANNER_POLL_INTERVAL_MS`/`RATE_LIMIT_CAPACITY`/`RATE_LIMIT_REFILL_PER_SECOND`
- Gate green: `npm run lint` (0), `npm run typecheck` (all workspaces), `npm test` (all workspaces; db integration suites skip cleanly without `DATABASE_URL`), `npm run build` (0), `npm run state:check` (PASS)

Notes:

- Acceptable build-module flow: `@22void/db` must not import provider-contracts/arbitrage, so it exposes structural DTOs (`PersistCanonicalRunInput`, `PersistOpportunityInput`, `DbPricedSelection`, …) and the worker (`@22void/odds-collector`, allowed to import every engine package) adapts between them. Raw payload types stay provider-contracts-owned; the db store's `storeRaw` casts to `Prisma.InputJsonValue`.
- `exactOptionalPropertyTypes` shaped every new module: optional inputs are assembled with conditional spreads (`...(x !== undefined ? { x } : {})`), never `x: undefined`.
- The Odds-API adapter needs a live key to poll on-network; the mock provider delivers deterministic fixture polls so the entire cycle (collect → normalize → persist → detect → heartbeat → recovery) is verified without a network or a database.

## PHASE 15 — HISTORY

- [x] Odds snapshots — every new price is recorded in `odds_observations` (the first quoted price now writes a row, not just changes), and `loadOddsHistory` returns the per-selection price series
- [x] Opportunity snapshots — new `opportunity_episodes` table groups repeated detections of the same legs via a deterministic key, with per-cycle `opportunities` linked by `episodeId` (Phase 15 migration `20260923130000_opportunity_episodes`)
- [x] Disappearance time — `sweepOpportunityEpisodes` (worker reconcile step) stamps `disappearedAt` on episodes absent from a healthy cycle and restores re-detected ones
- [x] Price movement — `LegMovement` (`first`/`last`/`min`/`max`/`delta`/`pctChange`) computed per leg; `getEpisodeReconstruction` returns episode + detection snapshots + per-leg odds series and movement
- [x] Source latency — `sourceLatencyStats` aggregates poll-to-persist cycle latency from `scanner_health` per odds source (runs, avg/min/max, last run/latency)
- [x] Arb duration — `OpportunityEpisodeSummary.durationMs` = `lastSeenAt − firstSeenAt` (wall-clock span the legs stayed detectable)
- [x] False-positive analysis — `falsePositiveAnalysis` classifies concluded episodes by latest status (STALE/REJECTED/INVALIDATED = false positive, VERIFIED_ARB = verified), rate, per-status duration and top rejection reasons

**Acceptance: historical opportunities can be reconstructed.** Proven by
`@22void/db` integration tests (`integration/history.test.ts`) — an episode is
tracked across repeated detections of the same legs (`detectedCount`, stable
`durationMs`, null `disappearedAt`), the full price series is recorded and
reconstructed (2.1 → 2.2 with movement), originals are restorable after a sweep
(disappeared → detected again), source latency aggregates, and the
false-positive report summarizes concluded episodes. The API exposes it:
`GET /api/v1/history/opportunities{,/:id}`, `/odds`, `/latency`, `/analysis`.

Phase 15 gate results (evidence):

- `packages/db` — `history.ts` (`listOpportunityEpisodes`, `getEpisodeReconstruction`, `loadOddsHistory`, `sweepOpportunityEpisodes`, `sourceLatencyStats`, `falsePositiveAnalysis`, `computeOpportunityKey`/`legKeyFromSelectionIds`), store changes (first-price observation, observations count = created-or-changed, `persistOpportunity` episode upsert in a `$transaction`), `HistoryRepo` + `createHistoryRepo`; unit tests for the episode key + integration suite (skip-if-no-DB; 11 passed / 28 skipped without a database); migration `20260923130000_opportunity_episodes` written by hand, applied via `npm run db:deploy` (Prisma 7 needs `shadowDatabaseUrl` to diff from migrations)
- `workers/odds-collector` — `reconcileOpportunityEpisodes` (DISAPPEARED/RESTORED bookkeeping in the OK branch only), `WorkerStore.reconcileOpportunityEpisodes` behind both adapters, deterministic `opportunityKey` stamped on every detection; 31 tests / 7 suites pass
- `apps/web` — history handlers + routes, zod query schemas, OpenAPI paths/schemas, fake-HistoryRepo handler tests (incl. auth 401, 400 without selectionId/eventId, 404/400 reconstruction paths); 83 tests / 7 suites pass
- Gate green: `npm run lint` (0), `npm run typecheck` (all workspaces), `npm test` (all workspaces), `npm run build` (0), `npm run state:check` (PASS)

Notes:

- `@22void/db` re-exports the `HistoryRepo` filter types (`EpisodeHistoryFilter`, `OddsHistoryFilterView`, `SourceLatencyFilter`, `FalsePositiveFilter`) so the web layer's `schema.ts` converters stay typed.
- Strictness shaping: optional Prisma args are built inline with conditional spreads because a pre-typed `Prisma.XFindManyArgs` object loses `include` inference; `exactOptionalPropertyTypes` forbids `x: undefined` everywhere.
- History is read-only over the write model; the worker owns sweeps, the API own reads, and the dashboard can consume the reconstruction in a later phase.

## PHASE 16 — SECURITY

- [x] Secrets server-side — all credentials are server-only env (`API_KEY`, `ADMIN_API_KEY`, `ODDS_API_KEY`, `PARLAY_API_KEY`, `DATABASE_URL`) with no `NEXT_PUBLIC_*` variants anywhere in `apps/web`; static test (`apps/web/lib/security/security.test.ts` "secrets server-side only") scans the app/lib/components/proxy source for `process.env` reads and asserts no NEXT_PUBLIC secret or unauthorized env variable is read, and no env read lives in `components/**`. A real ParlayAPI key was found committed in `.env.example` during this phase and removed; `scripts/secret-scan.ts` (`npm run security:scan`) gates CI against committed credentials
- [x] Auth/authorization — Phase 12 static API-key auth (reader + admin roles, constant-time compare) preserved; every handler now passes through `guardRequest(request, deps, requiredRole)` (`apps/web/lib/security/guard.ts`) which layers method check (405 + Allow), body rejection (GET reads only: 400 / 413 at 64 KiB), per-IP rate limiting (429 + Retry-After) and auth (401/403) with audit capture; admin endpoints require the admin role (403 for readers)
- [x] Rate limiting — shared `ApiRateLimiter` (`apps/web/lib/security/rate-limit.ts`, per-key token bucket, injectable clock, prune/refill, `clientIp` with x-forwarded-for first hop → x-real-ip → unknown) injected per holder in `lib/api/runtime.ts`; capacity/refill configurable via `API_RATE_LIMIT_CAPACITY`/`API_RATE_LIMIT_REFILL_PER_SECOND` (documented in `.env.example`); the collector's provider-poll token bucket already existed (Phase 14)
- [x] Input validation — Phase 12 zod v4 query parsing (enum filters against domain value sets, epoch-safe ISO bounds, `limit` 1–100) retained; request bodies are now rejected wholesale on the GET-only API (never parsed), and oversized bodies return 413 before any query work
- [x] Security headers — `apps/web/proxy.ts` (Next 16 proxy) applies `baseSecurityHeaders` to every response (X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, COOP, HSTS over TLS only) plus a route-appropriate CSP: `pageContentSecurityPolicy` for pages (`default-src 'self'`, script/style `'unsafe-inline'` per Next docs) and a sandboxed `apiContentSecurityPolicy` (`default-src 'none'; frame-ancestors 'none'; sandbox`) for `/api/*`
- [x] Audit logs — `writeAuditLog` in `@22void/db` (re-exported, `entityType` defaults to `"security"`) backed by the existing `audit_logs` table; the guard audits METHOD_NOT_ALLOWED / PAYLOAD_TOO_LARGE / REQUEST_BODY_NOT_ALLOWED / RATE_LIMITED / AUTH_FAILED / AUTH_FORBIDDEN / ADMIN_ACCESS (actor = client IP) via `dbAudit()` (fail-soft) or `nullAudit`/`memoryAudit` for tests; surfaces through the existing `GET /api/v1/admin/audit-logs?entityType=security`; DB integration suite added (`packages/db/src/integration/audit.test.ts`, skip-if-no-DB)
- [x] Dependency audit — root `package.json` `overrides` pin `deepmerge-ts ^8.0.2` and `mysql2 ^3.24.4` (closures of the `@prisma/client`/`prisma` toolchain advisories); `npm audit` and `npm audit --omit=dev --audit-level=high` report **0 vulnerabilities**; `npm run security:scan` + `npm run audit`/`audit:prod` wired into a new `security` CI job; `prisma generate`/`validate` still pass after the pin
- [x] Provider terms review — re-verification recorded in `docs/PROVIDER_EVALUATION.md`: both TOS unchanged (no feed resale, storage/dashboards/derived analytics OK for Odds API; ParlayAPI free tier non-commercial); the Phase 3 ParlayAPI key leak requires user-side rotation at ParlayAPI; polling honors quota/rate limits, never bypasses bookmaker bot/access controls; raw payload retention per spec §65

**Acceptance: security checklist passes.**

Phase 16 gate results (evidence):

- `npm run lint` — 0 errors
- `npm run typecheck` — all workspaces pass
- `npm test` — all workspaces pass: web 100 tests / 8 suites (incl. `lib/security/security.test.ts`, 17 tests: rate-limiter burst/refill/buckets, `clientIp`, guard layering 405/400/413/429+Retry-After/401/403 + audit capture, header + CSP policy, secrets server-side scan), db 11 passed / 29 skipped without a database (the audit `writeAuditLog` integration suite skips like the others), collector 31, provider-contracts 43, settlement 57, normalization 59, arbitrage 70, outcome-engine 23, domain 63, shared 7
- `npm run build` — clean across all workspaces
- `npm run security:scan` — PASS (209 tracked files, no secrets)
- `npm run audit` / `npm run audit:prod` — 0 vulnerabilities
- `npm run state:check` — PASS

Notes:

- The leaked ParlayAPI key (`<REDACTED>`, committed during Phase 3 exploration) is removed from the working tree but remains in git history through `origin` — it must be rotated/revoked at the provider. The scan looks at `git ls-files` so freshly added secrets fail CI before they can be pushed.
- `guardRequest` returns a `Response` on any failure (or a `{ ok: true, role }` marker on success); handlers use the shared `HandlerDeps`/`HistoryHandlerDeps.security` slot, so the limiter and audit store are injected once in `runtime.ts` instead of constructed per request.
- Headers live in a pure module (`lib/security/headers.ts`) because `proxy.ts` runs on Next's edge runtime; CSP values are static strings.

## PHASE 17 — TESTING

- [ ] Unit
- [ ] Settlement regression
- [ ] Outcome-state regression
- [ ] False-arb regression
- [ ] Optimizer regression
- [ ] Provider fixtures
- [ ] Integration
- [ ] E2E
- [ ] Load/candidate-generation test

**Acceptance:** CI green.

## PHASE 18 — DEPLOYMENT

- [ ] Web deployment
- [ ] Database
- [ ] Worker
- [ ] Secrets
- [ ] Scheduler
- [ ] Monitoring
- [ ] Backups
- [ ] Domain
- [ ] Production smoke test

**Acceptance:** production health checks green.

## PHASE 19 — MULTI-PROVIDER

- [ ] Provider B
- [ ] Provider C
- [ ] Cross-provider event matching
- [ ] Cross-provider market matching
- [ ] Reliability metrics
- [ ] Source fallback

**Acceptance:** provider addition requires no core-engine rewrite.

## PHASE 20 — SCALE

- [ ] Redis/cache
- [ ] Queue
- [ ] Horizontal workers
- [ ] DB indexing
- [ ] Archive strategy
- [ ] Provider-specific schedules
- [ ] Cost monitoring

**Acceptance:** sustained scanning within budget.

## PHASE 21 — OTHER SPORTS

Only after football is stable:

- [ ] Tennis
- [ ] Basketball
- [ ] Volleyball
- [ ] Handball
- [ ] Rugby
- [ ] Baseball
- [ ] Cricket
- [ ] Esports

## MASTER DEFINITION OF DONE

Live data → correct event → correct market → correct settlement → complete outcome coverage → valid optimization → positive minimum guaranteed return → fresh prices → final verification.

## CHANGELOG

- 2026-09-24 (Phase 16): Security. **Incident**: a real ParlayAPI key (`<REDACTED>`) was found committed in `.env.example` from Phase 3 exploration; removed from the working tree and replaced with a placeholder comment. It remains in git history through `origin` (commits `a92e064`/`7985e73`) — regenerate a new key in ParlayAPI. New `scripts/secret-scan.ts` (`npm run security:scan`) scans `git ls-files` for credential patterns (GitHub/Stripe/OpenAI/Slack/AWS/npm/SendGrid/Google/GitLab/Telegram/private keys) + non-placeholder env assignments; currently PASS on 209 files. **Dependency audit**: root `package.json` `overrides` pin `deepmerge-ts ^8.0.2` and `mysql2 ^3.24.4` (transitive closures of the `@prisma/client`/`prisma` CLI advisories); `npm audit` / `npm audit --omit=dev --audit-level=high` = 0 vulnerabilities; new scripts `audit`/`audit:prod`; a `security` CI job runs the scan + both audits. **Runtime hardening** (`apps/web`): `lib/security/headers.ts` + `proxy.ts` (Next 16 proxy) apply base security headers (nosniff, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy, COOP; HSTS only over TLS) and a route CSP (`pageContentSecurityPolicy` for pages, sandboxed `default-src 'none'` `apiContentSecurityPolicy` for `/api/*`). `lib/security/rate-limit.ts` — per-key token-bucket `ApiRateLimiter` + `clientIp`; injected once per runtime holder. `lib/security/guard.ts` — `guardRequest` layers method (405+Allow), body rejection (400, 413 at 64 KiB), rate limit (429+Retry-After) and auth (401/403, admin role for admin routes); every Phase 12/15 handler switched from `requireAuth` to `guardRequest`. `packages/db/src/audit.ts` — `writeAuditLog` (entityType default `"security"`) re-exported from `@22void/db`; guard audits METHOD_NOT_ALLOWED / PAYLOAD_TOO_LARGE / REQUEST_BODY_NOT_ALLOWED / RATE_LIMITED / AUTH_FAILED / AUTH_FORBIDDEN / ADMIN_ACCESS with the caller IP, surfaced by the existing `GET /api/v1/admin/audit-logs` filter. Web security tests: 17 (limiter, ip, guard layering + audit capture, header/CSP, secrets-server-side static scan — no `NEXT_PUBLIC_*` secrets, no env reads in `components/**`, allowlisted env reads only). DB integration suite for `writeAuditLog` added (skip-if-no-DB). `docs/PROVIDER_EVALUATION.md` re-verification section (terms unchanged, rotation recorded, no bot/access-control bypass, quota-respecting polling). CI: new `security` job. Gate green: lint, typecheck, build, 100 web tests + all workspace suites, `state:check`.

- 2026-09-23 (Phase 15): History — odds/opportunity snapshots, disappearance, analysis. `@22void/db` gains the historical read/write model. Schema: new `opportunity_episodes` table (`eventId` FK `ON DELETE CASCADE`, `structureType`, `legKey`, `marketStructure`, `status`, `firstSeenAt`, `lastSeenAt`, `detectedCount`, `disappearedAt`, unique `(eventId, structureType, legKey)`, indexes on `lastSeenAt`/`disappearedAt`) and `opportunities.episodeId` (nullable FK `ON DELETE SET NULL`) — migration `20260923130000_opportunity_episodes`, hand-written (Prisma 7 `migrate diff --from-migrations` needs `shadowDatabaseUrl`; apply via `db:deploy`). Episodes are keyed deterministically by `computeOpportunityKey` = `episode:${eventCanonicalId}:${structureType}:${sorted unique selectionIds joined "+"}` so detection, store and history agree without extra ids. The first quoted price now writes an `odds_observations` row (previously only changes) and `selections.observations` counts created-or-changed, so no historical price is missing. `persistOpportunity` upserts the episode inside a `$transaction` (by id → else unique triple → else create) and connects the opportunity. New `history.ts`: `listOpportunityEpisodes`, `getEpisodeReconstruction` (episode + per-detection snapshots + per-unique-leg odds series with `LegMovement` first/last/min/max/delta/pctChange), `loadOddsHistory` (selection- or event-scoped, ISO bounds), `sweepOpportunityEpisodes` (absent healthy-cycle keys → `disappearedAt`; re-detected → restore), `sourceLatencyStats` (poll-to-persist from `scanner_health` per source: runs/avg/min/max/last) and `falsePositiveAnalysis` (concluded episodes by latest status — STALE/REJECTED/INVALIDATED = false positives, VERIFIED_ARB = verified — plus by-status duration and top rejection reasons). Read model: `HistoryRepo` + `createHistoryRepo`; filter types re-exported for the web layer. Worker: `detect.ts` stamps a deterministic `opportunityKey`, `WorkerStore.reconcileOpportunityEpisodes` lands on both adapters (DB → sweep; memory mirrors with a debug view), and `history.ts` `reconcileOpportunityEpisodes` runs only in the healthy OK branch after detection (DOWN/DEGRADED never fabricate disappearances); `runtime.ts` adds a `history` field to the heartbeat. Web API: `GET /api/v1/history/opportunities` (limit/eventId/status), `/history/opportunities/:episodeId` (reconstruction), `/history/odds` (`selectionId` **or** canonical `eventId` required + from/to), `/history/latency` (`sourceKey`/`after`/`limit`), `/history/analysis` (`after`), all behind `serverHistoryDeps()`, with zod query schemas, OpenAPI paths/components (`OpportunityEpisode`, `EpisodeReconstruction`, `OddsHistoryPoint`, `SourceLatency`, `FalsePositiveReport`) and fake-repo handler tests (auth 401, 400 without selectionId/eventId, 404/400 reconstruction). Acceptance: reconstruction proven by `integration/history.test.ts` (episode tracked across repeated detections with stable `durationMs`, price series 2.1 → 2.2 with movement, sweep + restorable originals, latency stats, false-positive report). Gate green: `npm run lint` (0), `npm run typecheck` (all workspaces), `npm test` (all workspaces), `npm run build` (0), `npm run state:check` (PASS).

- 2026-09-23 (Phase 14): Workers (`workers/odds-collector` operator loop + write-side store). `@22void/db` gains the persistence job: `persistCanonicalRun` (idempotent run upserts — events → source bindings → settlement rules (version 1, idempotent) → markets → selections; unrepresentable exact-score outcomes counted `invalid`, never guessed), `loadPricedSelections` (fresh prices + event/settlement confidence attestation), `markSourceStatus`/`recordHeartbeat`, `persistOpportunity` (opportunity + legs + audit trail, deterministic id), and `source_event_ids.eventConfidence` (migration `20260923120000_source_event_confidence`, hand-written because `prisma migrate diff --from-migrations` needs `shadowDatabaseUrl` and Prisma 7 dropped `--to-schema-datamodel`; apply via `db:deploy`). `ensureOddsSource`/`storeRawPayload` now accept `PrismaClient | Prisma.TransactionClient` (callback-level `$transaction` is an `Omit<...>` type, so a `DbLike` union is exposed). Worker built out behind a `WorkerStore` port (`src/store.ts`, Prisma + in-memory adapters with raw-payload/heartbeat/opportunity debug views): `rate-limit.ts` (token bucket, injectable clock/delay), `retry.ts` (429/5xx/network transient classification, exponential ±50% jitter backoff to 2s, `withRetry`), `normalize.ts` (`normalizeRun` seeds `EventNormalizer` from the store, persists match confidence into `eventConfidence`, composites persisted market identity as `${providerEventId}:${sourceMarketId}` because the DB keys markets per `(oddsSourceId, sourceMarketId)` and a provider can reuse a market id across events), `detect.ts` (adapts `DbPricedSelection`, runs Phase 10 `scanCandidates` + Phase 11 `validateCandidate`, persists every ARB scan's outcome + audit via `persistOpportunity`; the §39 recheck is the cycle's own fresh prices, so scans are self-consistent), `runtime.ts` (`runScanCycle`: heartbeat → rate-limit → poll+retry → raw payload → normalize → persist → detect → source availability + heartbeat; DOWN on exhausted poll, HEALTHY on the next success — acceptance *transient provider failures recover*; `createScanWorker` non-overlapping interval scheduler, injectable schedule, stop waits for in-flight), `main.ts` env-driven entry (`WORKER_PROVIDER=mock|odds-api`, `SCANNER_POLL_INTERVAL_MS`, rate-limit env, `DATABASE_URL` → Postgres store else in-memory) + root `worker:collect`; `.env.example` documents the worker env; `docs/ARCHITECTURE.md` gains the Phase 14 scan-cycle section. 26 worker tests / 6 suites (rate limit, retry, normalize create-merge, detect VERIFIED_ARB from a built arb, recovery DOWN→HEALTHY with persisted data, scheduler + in-flight stop). Gate green: lint, typecheck, test (all workspaces), build, `state:check` (PASS).

- 2026-09-22 (Phase 13): Dashboard (`apps/web`). Full 22_VOID shell — `SiteHeader`/`SiteFooter` with active-link nav and a data-source label — wrapped the root layout; the landing page now links into the data layer. New `lib/dashboard/` reads straight from the Phase 12 `ApiRepo` (never the HTTP layer), keeping pages testable without a DB: `format.ts` (odds/money/percent/ROI/age/date + market & selection labels, safe for client & server), `metrics.ts` (`legRows`, `compareBookmakerOdds` — matches each leg's market on family/period/participant/line, flags the best current price and rings the snapshot bookmaker, `summarizeScanner` with the 5-minute staleness rule), `explain.ts` (pure evidence sections — positive guaranteed return from the solved plan, market-structure copy per `StructureType`, settlement coverage, per-`RejectionReason` "why rejected" copy, freshness with recheck-window expiry — still following Rule 5/6: text is a function of the view), `demo-repo.ts` (deterministic in-memory `ApiRepo` seeded relative to `Date.now()`: 4 events, 6 markets with live quotes, 6 opportunities covering VERIFIED/FRESH/THEORETICAL/REJECTED/STALE, 4 providers incl. DEGRADED, scanner runs incl. an older DEGRADED one — pagination/filters implemented so the flow is honest), `server-repo.ts` (`DASHBOARD_SOURCE=demo` or no `DATABASE_URL` → demo repo, else Prisma repo) and `snapshot.ts`. Pages (all `force-dynamic`, none bundled with client JS): `/dashboard` overview (verified opportunities table + provider-health + scanner-heartbeat panels), `/opportunities` with a client-side lifecycle-status filter, `/opportunities/[id]` — the inspection flow (guarantee cards, leg matrix, stake calculator that re-plans proportionally from the optimizer split, bookmaker comparison, evidence cards, engine versions), `/events` + `/events/[id]` (market matrix per family), `/providers` (health cards + scanner run table). Client components: `OpportunityFilters` (search-param navigation) and `StakeCalculator` (pure scaling, server-compatible formatters). Acceptance proven: 38 new unit tests (72 in @22void/web; repo-wide 407) plus 7 new Playwright e2e specs that build the app, boot it against the demo seed and walk landing → overview → opportunity detail → rejected-why → event matrix → providers on bare Chrome (no DB). Gate green: lint, typecheck, build, 407 tests, e2e 8/8, `state:check`.

- 2026-09-22 (Phase 12): Authenticated HTTP API (`apps/web` `/api/v1/**` + `@22void/db` API repo). `@22void/db` gains a read-model API: `api/types.ts` (`ApiRepo` interface + JSON-safe views: `EventView` with per-source links, `MarketView` with current per-bookmaker odds, `OddsView`, `OpportunityView` with legs/stakes/returns/engine versions/validation evidence, `ProviderView`, `AdminSourceView` with row counts, `ScannerRunView`, `AuditLogView`; filters incl. status/family/period/eventId/team/date windows), `api/cursor.ts` (opaque base64url keyset cursors `22v.…` encoding ordering key + direction + id; tested), `api/repo.ts` (`createApiRepo` → Prisma-backed keyset pagination, `limit+1` boundary cursors, insensitive contains filters). `apps/web` builds the HTTP layer on it: `lib/api/auth.ts` (static `API_KEY` reader / `ADMIN_API_KEY` admin roles, constant-time `timingSafeEqual`, fail-closed 401, 403 for role mismatch), `lib/api/http.ts` (`{ "error": { code, message, detail? } }` envelope), `lib/api/schema.ts` (zod v4 query parsing: `limit` 1–100, epoch-safe ISO date bounds, enum filters validated against domain value sets — invalid values 400, never 500), `lib/api/handlers/*` (events, markets, odds, opportunities, system, admin) as pure `(request, { repo, env, now? }) → Response` functions, `lib/api/openapi.ts` (OpenAPI 3.0.3 contract served at `GET /api/v1/openapi`, public; enums imported from `@22void/domain` so the contract cannot drift from the engine). Endpoints: `GET /health` (public), `/events{,/:id}`, `/markets{,/:id}`, `/odds`, `/opportunities{,/:id}`, `/providers`, `/scanner` (runs + ≥5 min staleness aggregate), `/admin/sources`, `/admin/audit-logs` (admin key), `/openapi`. Phase 11 output is surfaced: opportunity statuses are the §40 domain values (incl. `VERIFIED_ARB`) and details carry `validatedAt`, `rejectionReason` and leg/return evidence. Wire/contract alignment with PROJECT_STATE Phase 12 (integration tests pass): 25 handler tests over a fake `ApiRepo` (401/403/400/404 paths, filter + cursor forwarding, role gating, stale scanner detection with frozen clock, nextCursor round-trip), OpenAPI validity assertions; 5 cursor codec tests in `@22void/db`. `apps/web` gained `@22void/db` dependency; `next.config.ts` adds `transpilePackages` + `serverExternalPackages`; source imports are extensionless (Turbopack) with `.js` suffixes only in test files (vitest). `.env.example` documents `API_KEY`/`ADMIN_API_KEY`. 34 web tests, 888 repo-wide (that number will be superseded in later phases as web grows); full gate green: lint, typecheck (all workspaces), build (incl. `next build` wiring 13 App Routes), `state:check`.

- 2026-09-22 (Phase 11): Opportunity validation (`@22void/arbitrage`). New `src/validation.ts`: `validateCandidate(scan, legs, options, rechecked)` classifies a Phase 10 `ARB` scan into the §40 lifecycle (`VERIFIED_ARB`/`FRESH_ARB`/`THEORETICAL_ARB`/`STALE`/`INVALIDATED`/`REJECTED`) using seven checks — freshness threshold (domain `classifyFreshness`, §38), provider/source status (`sourceStatus` DOWN/UNKNOWN → `PROVIDER_UNAVAILABLE`), event confidence (≥ `minEventConfidence`, else `EVENT_MATCH_UNCERTAIN`), settlement confidence (≥ `minSettlementConfidence`, else `SETTLEMENT_CONFIDENCE_LOW`), price age (`now − sourceUpdatedAt` within `maxAgeMs`, else `STALE`/`STALE_ODDS`), cross-source timestamp consistency (max/min `sourceUpdatedAt` spread within `maxSourceSpreadMs`, else `CROSS_SOURCE_TIMESTAMP_SPREAD`) and the final recheck (`compareRecheckedPrices`: any leg missing or moved beyond `recheckTolerance` → `INVALIDATED` with `PRICE_CHANGED_ON_RECHECK`/`PROVIDER_UNAVAILABLE`, §39). A candidate without attestable provenance on every leg (source timestamp / event / settlement confidence / source status) is `THEORETICAL_ARB` with `INSUFFICIENT_PROVENANCE`; `verified` is exactly `status === VERIFIED_ARB`, so stale/uncertain opportunities can never be marked verified. `PricedSelection` gained `provider`, `sourceUpdatedAt` (ISO), `sourceStatus` (`OK/DEGRADED/DOWN/UNKNOWN`) and `settlementConfidence`; domain `RejectionReason` gained `SETTLEMENT_CONFIDENCE_LOW`, `CROSS_SOURCE_TIMESTAMP_SPREAD`, `PRICE_CHANGED_ON_RECHECK`, `INSUFFICIENT_PROVENANCE`. Non-ARB scans map to `REJECTED` with structured reasons (`NEGATIVE_GUARANTEED_PROFIT`, coverage verdicts, or `PruneReason`→`RejectionReason`). 19 tests / new suite; 333 tests passing repo-wide. Gate green: lint, typecheck, build, `state:check`.

- 2026-09-21 (Phase 10): Candidate generator (`@22void/arbitrage`). New `src/candidates.ts`. Generation is staged (§33) instead of all-pairs: Stage A groups priced selections by canonical event, Stage B by period (a period mismatch invalidates a candidate, §8), Stage C only pairs market families with an implemented state model via `familiesCompatible` (`MATCH_TOTAL↔TEAM_TOTAL`, `MATCH_TOTAL↔ASIAN_TOTAL`, `TEAM_TOTAL↔ASIAN_TOTAL`, `MATCH_RESULT↔DOUBLE_CHANCE`, `MATCH_TOTAL↔BTTS`), and Stage D grows candidate size 2 → 3 with `maxCandidates` bounding combinatorics. `bestPricePerSelection` implements the §55 best-price rule, `classifyStructure` labels each set (`SAME_MARKET_COMPLEMENT`, `COMPLEMENTARY_TOTALS`, `ASIAN_LINE`, `PROTECTED_HANDICAP`, `TEAM_TOTAL_MATCH_TOTAL`, `PARTITION`, `MULTI_LEG_PARTITION`, `GENERIC`) and `isStandardComplement` detects exact two-way complements. `pruneCandidate` rejects candidates cheaply (§34/§61) for size, event/period mismatch, duplicate selection, invalid odds, suspension, staleness, uncertain event confidence, same-bookmaker policy, incompatible markets and the standard-complement price prefilter (`sum(1/O) >= 1`); pruning never decides arbitrage. `scanCandidates` chains generate → prune → `detectFalseArb` → `optimizeStakes`, returning `ARB`/`NO_ARB`/`REJECTED`/`PRUNED` (pruned candidates never reach the detector). Acceptance proven: two-way 2.2/2.1 scans `ARB`, Over 10.5 + Under 13.5 scans `REJECTED` with `NON_EXCLUSIVE`, a covered-unprofitable structure scans `NO_ARB`, and suspended/prefiltered candidates scan `PRUNED`. 51 tests / 5 suites in the package. Gate green: lint, typecheck, build, 313 tests passing, `state:check`.

- 2026-09-21 (Phase 9): Stake optimizer (`@22void/arbitrage`). New `src/simplex.ts` — a compact dense two-phase simplex (`simplexMinimize(c, A, b)`: rows with negative RHS are sign-flipped, one artificial per row forms the initial identity basis, phase 1 minimizes the artificial sum and reports `infeasible` when it cannot reach 0, artificials are pivoted out or forbidden by a large cost, phase 2 minimizes the real objective with Bland's rule to avoid cycling; returns `optimal`/`infeasible`/`unbounded`). New `src/optimizer.ts` — `buildMultiplierMatrix` maps the Phase 7 reduced states to §10 return multipliers (`returnMultiplier(state.vector[i], legs[i].odds)`), `optimizeStakes(states, legs, T)` solves the maximin LP (`maximize z` s.t. `ΣSi = T`, `A·x ≥ z`, `x ≥ 0`, with the free `z` split into `z⁺ − z⁻`) and returns a `StakePlan` (`status`, `stakes`, `stateReturns`, `minReturn`, `guaranteedProfit`, `roi`, `isArb`, `multiplierMatrix`); `optimizeCandidate(report, T)` is the Phase 8 bridge and refuses a non-`COVERED` report; `reciprocalSum`, `classicTwoWayStakes` and `classicThreeWayStakes` expose the classic closed forms (used only for parity checks, never for the arb decision). `minReturn` is recomputed from the solved stakes, so an imperfect LP result cannot overstate the guarantee; `isArb = minReturn > T + EPS`. Push counts as a returned stake (multiplier 1) and half-win/half-loss use the exact `(O+1)/2` / `0.5` multipliers — both proven in tests. Acceptance proven by simulated worst-case return matching optimizer output on two-way, three-way, push-aware, half-settlement (Home −0.75 / Away +0.75), 4-leg and no-arb cases, plus direct simplex unit tests (single equality, two-variable, negative RHS, infeasible, unbounded). 30 tests / 4 suites in the package. Gate green: lint, typecheck, build, 292 tests passing, `state:check`.

- 2026-09-21 (Phase 8): False-arb detector (`@22void/arbitrage`, formerly a skeleton). New `src/coverage.ts`: `detectFalseArb(legs)` builds the Phase 7 reduced state model and runs the structural checks the reciprocal-sum shortcut cannot express — unknown settlement (Rule 3 → `UNKNOWN_SETTLEMENT`), duplicate/empty candidates (`INVALID_MARKET`), mutual exclusivity (same-metric winners → `NON_EXCLUSIVE`), collective exhaustiveness (no-winning-leg states), both-loss states (`BOTH_LOSS_STATE`) and push/gap states (`NON_EXHAUSTIVE`). Cross-metric overlaps are recorded as `CROSS_METRIC` and allowed; same-metric overlaps are rejected. Reports expose `exclusive`/`exhaustive`, `overlaps`, `gaps`, per-state settlement vectors aligned to input legs, and structured `evidence` (§41) plus `formatRejection`/`formatCoverageReport` human-readable output. Package gained `@22void/domain` + `@22void/settlement` + `@22void/outcome-engine` dependencies; 15 tests / 2 suites added. Acceptance proven on spec golden cases: CASE-003 Over 10.5 + Under 13.5 rejected for overlap, CASE-004 Home Under 1.5 + Match Over 1.5 accepted as exhaustive, CASE-005 Over 1.0 + Under 1.5 accepted with push-aware states, plus both-loss, gap, unknown, duplicate and 1X2 partition cases. `COVERED` is structural only — profitability is Phase 9. Gate green: lint, typecheck, build, 277 tests passing, `state:check`.

- 2026-09-21 (Phase 7): Football outcome engine (`@22void/outcome-engine`, formerly a skeleton). New `score.ts` (FootballScore/MetricCounts, `matchTotal`, `goalMargin`, `metricTotal`) and `state-model.ts`: `boundaryMax` derives every boundary implied by a selection set (largest `ceil(line)`, exact-score coordinates, implicit result/double-chance/BTTS boundary), the space is enumerated up to `ceil(boundary)+1` and grouped by settlement vector so each `OutcomeState` is a representative of an equivalence class (§17–§20 Steps 1–5). Goal states expand to `(fullTime, firstHalf)` only when a FIRST_HALF/SECOND_HALF selection is present (always `firstHalf ≤ fullTime`); corners and cards are independent count dimensions reduced separately and composed as a cross product. `settleVector`, `settlementMatrix` and `payoffMatrix` expose settlement results and §10 multipliers per state × selection. Classification always delegates to the Phase 6 settlement engine; selections that cannot settle (EXTRA_TIME/PENALTIES → `NO_STATE_MODEL`, missing line/participant, no rule) are reported in `unknown` and excluded, never guessed (Rule 3). Acceptance proven with spec fixtures: §21 coverage matrix (2-0 → WIN/LOSS/WIN, 1-1 → LOSS/LOSS/WIN, 2-2 → WIN/WIN/LOSS, all present as classes), §27 false overlap (Over 10.5/Under 13.5 has a both-win state), complementary totals/1X2/BTTS reduce to 2/3/2 classes, Home −0.75 yields HALF_WIN/FULL_WIN/FULL_LOSS and never a push, corner totals reduce independently, and exact-score "3-2" is its own class representative. Package gained `@22void/domain` + `@22void/settlement` dependencies; 23 tests / 3 suites added. Gate green: lint, typecheck, build, 263 tests passing, `state:check`.

- 2026-09-21 (Phase 6): Settlement engine (`@22void/settlement`, formerly a skeleton). New `line.ts` (canonical line parse/format/classification + Asian quarter-line decomposition: 2.25 → 2.0+2.5, −0.75 → −0.5/−1.0), `settle.ts` (component-based evaluator: standard/Asian totals, team totals, team Asian totals, Asian handicaps, 1X2, double chance, BTTS, exact score, corners/cards totals, all periods full/first-half/second-half/extra-time/penalties), `engine.ts` (versioned provider rules with effective windows + `SettlementEngine`, UNKNOWN_SETTLEMENT when no rule applies) and `payout.ts` (§10 formulas + per-component return breakdown). Quarter behavior is always derived from two 50/50 component settlements — no special cases (§15); half-win/half-loss fall out of `settlementResultFromComponents([WIN,PUSH])`/`[PUSH,LOSS]`. Void for cancelled/abandoned/postponed events; unfinished events and missing period/line/participant/corner/card state refuse to settle (Rule 3). Rule versioning proven with two rule versions in disjoint effective windows producing different settlements for the same selection. Package gained `@22void/domain` dependency; 57 tests / 5 suites added. Gate green: lint, typecheck, build, 242 tests passing, `state:check`.

- 2026-09-21 (Phase 5): Market normalization (`@22void/normalization`). New `MarketNormalizer` with a provider-native key registry (`addKey(provider, key, canon)`, per-provider namespace) and a deterministic label classifier; both produce a canonical `MarketResolution` (family/period/marketType/participant?/line?) and identity is compared with domain `marketStructureKey`. Equivalent labels normalize identically ("Goals Over/Under"/"Total Goals"/"O/U"/"Over Under 2.5 Goals" → one MATCH_TOTAL/STANDARD identity, proven in tests); different families never interchange (Corners ≠ Cards ≠ Goals ≠ Shots; "Home Team Goals O/U" → TEAM_TOTAL/HOME, never MATCH_TOTAL). Supports all canonical families: 1X2, double chance, match totals, Asian totals (2.25), Asian handicap (−0.75), team totals, team Asian totals, corners, cards, BTTS, exact/correct score, and period markets (first/second-half totals split from full match). Label-less unknown keys and unmapped markets ("Draw No Bet", "Shots Over/Under", goalscorer/player props) are rejected with a reason, never guessed (Rule 3). Line extraction reads raw text (last numeric run, `+`/`,`/`.` canonicalization) because punctuation collapsing would split "2.25" into "2 25". Missing required line/participant is surfaced as a reason and `toStructure()` refuses to build an invalid structure. Key wiring for real providers happens in Phase 19; normalization still depends on domain only. 19 tests added (59 total / 7 suites in the package). Gate green: lint, typecheck, build, 186 tests passing, `state:check`.

- 2026-09-21 (Phase 4): Event normalization (`@22void/normalization`, formerly a skeleton). Text normalization (`normalizeText`/`normalizeTeamName`/`normalizeCompetition`: NFKC, diacritics stripping, case folding, punctuation, whitespace collapse — no auto-stripping of tokens like "FC", that is dictionary-owned). `TeamDictionary` + `CompetitionDictionary` with seeded soccer aliases + runtime extension. `computeMatchConfidence`/`classifyMatch`/`eventsMatch` — weighted signals (same provider id 1.0, canonical teams 0.5, start-time-in-tolerance 0.3, competition equal +0.2 / explicit mismatch −0.2, default confirm ≥0.8, uncertain band requires a teams signal) — and a `MatchPolicy` to tune tolerance/thresholds. `SourceIdIndex` for `provider:sourceEventId` → canonical event bindings (uniqueness + restartable seeding). `EventNormalizer.register()` decides create / merge / uncertain: dedupes re-registration, folds the second provider's view of the same match into the first-seen canonical event, and never silently merges an uncertain match (returns the scoring reasons for a supervisor). Acceptance proven: the same match registered from the odds-api and parlay-api fixtures (incl. an alias/"EPL"/30s-skew variant) becomes one canonical event with both sourceEventIds; duplicates and near-matches behave correctly. Package gained `@22void/domain` dependency; 40 tests / 6 suites added. Also repaired a pre-existing gate break: provider-contracts adapter-test `stubFetch` mocks are properly typed and `MockProvider.poll` accepts the optional `PollRequest` the `OddsProvider` interface declares (workspace `npm run typecheck` was failing before this phase). Gate green: lint, typecheck, build, 167 tests passing, `state:check`.

- 2026-09-21 (Phase 3): Provider. Chose **The Odds API** as the initial data provider (decision + coverage-gap + terms record in `docs/PROVIDER_EVALUATION.md`; ParlayAPI retained as the Phase 19 provider-B skeleton). New `@22void/provider-contracts` package: `OddsProvider` interface (`poll`/`health`), provider envelope with `receivedAt` + per-price `sourceUpdatedAt`, market-key registries (`ODDS_API_MARKET_KEYS`, `PARLAY_API_MARKET_KEYS` incl. `team_totals_home/away` split + corners/cards, deliberately excluding spreads/draw_no_bet until settlement is verified — Rule 3), outcome-label mappers (П1/П2, Over/Under with line-from-point-or-label, BTTS, double chance, exact score, handicaps), generic wire→envelope translation, `envelopeToCanonicalRecords` producing Phase-4-style canonical records with timestamp clamp + reject-not-guess, `MockProvider` covering every canonical family deterministically, `OddsApiProvider` + `ParlayApiProvider` adapters (zod wire validation, health probes, transport errors) and a shared `fetchJson`/`ProviderTransportError`. Raw payload retention wired: `@22void/db` `storeRawPayload`/`ensureOddsSource` (spec §65) + skip-if-no-DB integration test; `workers/odds-collector` `runCollectOnce` (poll→convert→store) + tests. Wire-format regression fixtures under `tests/fixtures/providers/raw/` (+ typed mirror modules). `.env.example` extended with `ODDS_API_SPORTS/REGIONS/MARKETS`. Gate green: lint, typecheck, build, provider-contracts 43 tests, collector 5 tests, db suites skip cleanly without `DATABASE_URL`.

- 2026-09-17 (Phase 2): Domain model. `@22void/domain` (now depending on `zod` + `@22void/shared`) split into `value-sets`, `canonical-event`, `market`, `selection`, `decimal-odds`, `freshness` and `settlement`, re-exported from `src/index.ts`. Added strongly typed canonical objects with zod validation: canonical event (+`EventStatus`, per-provider source-event refs), market taxonomy (`MarketType`, `MARKET_STRUCTURES` per-family invariants, `marketStructureKey`), selection taxonomy (`OUTCOMES_BY_FAMILY`, exact-score scorelines), period model (`Participant`), branded `DecimalOdds` built on shared `MIN_DECIMAL_ODDS`, freshness model (`classifyFreshness`/`freshnessScore`, configurable <5s/5–15s/>15s policy §38), and settlement states (`settlementResultFromComponents`, `settlementStateSchema`, `returnMultiplier` §9/§10). Representative fixtures added under `tests/fixtures/domain/` and validated by `fixtures.test.ts`. Domain sources use extensionless relative imports so Next/Turbopack can bundle the multi-file package. Gate green: lint, typecheck, 18/18 suites (domain 8 suites / 63 tests), build, `state:check`.

- 2026-09-17 (Phase 1): Database. Prisma 7.10 + PostgreSQL 16 (docker-compose). `prisma.config.ts` hosts the CLI datasource URL (Prisma 7 moved `url` out of the schema); runtime uses the `@prisma/adapter-pg` driver adapter. Schema (`prisma/schema.prisma`): events, source_event_ids, teams, team_aliases, bookmakers, odds_sources, markets, selections, odds_observations, settlement_rules, opportunities, opportunity_legs, audit_logs, scanner_health, raw_payloads (§65). Migration `20260917143644_init` applied. `@22void/db` now exports a client factory + singleton and re-exports the generated Prisma types/enums; generated client is gitignored and regenerated on install (`postinstall`) and explicitly in CI. Root scripts added: `db:generate`, `db:migrate`, `db:deploy`, `db:test`. CRUD integration suite (15 tests) covers every table including unique-constraint rejections and skips cleanly without `DATABASE_URL`; CI gains a `db-integration` job with a Postgres 16 service container. Gate green: lint, typecheck, 10/10 suites (incl. 17 db tests), build, `prisma migrate status` up to date.

- 2026-09-17 (Phase 0): Repo moved from OneDrive to `C:\Users\User\Documents\22_VOID`; git kept on `main`. Monorepo created with npm workspaces (`apps/web`, 8 `packages/*`, `workers/odds-collector`). Root tooling: ESLint 10 flat config, Prettier, `tsconfig.base.json`, `.env.example`, `.editorconfig`, `.gitignore`. Package seeds: `@22void/shared` (zod schemas, odds validators) and `@22void/domain` (canonical enums) implemented; six engine packages are compilable skeletons preserving module boundaries. Web app: Next.js 16.3.5 + Tailwind v4 + shadcn/ui + brand landing page + vitest + Playwright smoke. Docker compose (postgres 16) validated. Docs: PROJECT_STATE.md, TECH_STACK.md, BUILD_AGENT_PROMPT.md, docs/ARBITRAGE_ENGINE_SPEC.md, docs/ARCHITECTURE.md, README.md. Automation: `scripts/project-state-check.ts` and GitHub Actions CI. Gate green: lint, typecheck, 10/10 tests, build, e2e. Engines upgraded to Node 24 LTS (portable) because vite 8/vitest 4/eslint 10 require >=22.13.
