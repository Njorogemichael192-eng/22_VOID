# 22_VOID — PROJECT STATE / MASTER TODO

Version: 1.1

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

Phase 0 — Foundation

## NEXT ACTION

Phase 1 — Database: Supabase project, Prisma schema + migrations for events, source event IDs, teams/aliases, bookmakers, odds sources, markets, selections, odds observations, settlement rules/versioning, opportunities, opportunity legs, audit logs, scanner health; CRUD integration tests.

---

## IDENTITY

- [x] Project name: 22_VOID
- [x] Cloud-hosted architecture
- [x] Football-first scope
- [ ] Confirm initial data provider
- [ ] Confirm production terms/use rights
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

- [ ] Supabase project
- [ ] Prisma + migrations
- [ ] events
- [ ] source event IDs
- [ ] teams/aliases
- [ ] bookmakers
- [ ] odds sources
- [ ] markets
- [ ] selections
- [ ] odds observations
- [ ] settlement rules/versioning
- [ ] opportunities
- [ ] opportunity legs
- [ ] audit logs
- [ ] scanner health

**Acceptance:** migrations and CRUD integration tests pass.

## PHASE 2 — DOMAIN MODEL

- [ ] Canonical event
- [ ] Market taxonomy
- [ ] Selection taxonomy
- [ ] Period model
- [ ] Decimal odds representation
- [ ] Freshness model
- [ ] Settlement states

**Acceptance:** representative fixtures validate correctly.

## PHASE 3 — PROVIDER

- [ ] Provider interface
- [ ] Mock provider
- [ ] Evaluate ParlayAPI
- [ ] Evaluate Odds-API.io
- [ ] Verify football coverage
- [ ] Verify bookmaker coverage
- [ ] Verify Asian totals/handicaps
- [ ] Verify team totals
- [ ] Verify corners/cards
- [ ] Verify Kenya/use restrictions
- [ ] Verify redistribution/commercial rights
- [ ] Choose initial provider
- [ ] Implement adapter
- [ ] Store raw payloads
- [ ] Store timestamps

**Acceptance:** live payload converts to canonical records.

## PHASE 4 — EVENT NORMALIZATION

- [ ] Team alias dictionary
- [ ] Case/Unicode normalization
- [ ] Home/away normalization
- [ ] Competition normalization
- [ ] Start-time matching
- [ ] Source ID mapping
- [ ] Duplicate prevention
- [ ] Match confidence

**Acceptance:** same event from multiple sources becomes one canonical event.

## PHASE 5 — MARKET NORMALIZATION

- [ ] 1X2
- [ ] Double chance
- [ ] Match totals
- [ ] Asian totals
- [ ] Asian handicap
- [ ] Team totals
- [ ] Team Asian totals
- [ ] Corners
- [ ] Cards
- [ ] BTTS
- [ ] Period markets
- [ ] Exact/range partitions where supported

**Acceptance:** equivalent markets normalize identically; non-equivalent markets do not.

## PHASE 6 — SETTLEMENT ENGINE

- [ ] Full win
- [ ] Full loss
- [ ] Push
- [ ] Half win
- [ ] Half loss
- [ ] Void
- [ ] Asian totals
- [ ] Asian handicaps
- [ ] Standard totals
- [ ] Team totals
- [ ] Period settlement
- [ ] Rule versioning

**Acceptance:** exhaustive settlement tests pass.

## PHASE 7 — FOOTBALL OUTCOME ENGINE

Use score state (H,A), with total T=H+A.

- [ ] Generate relevant score states
- [ ] Match totals
- [ ] Asian totals
- [ ] Team totals
- [ ] Team Asian totals
- [ ] 1X2
- [ ] Handicaps
- [ ] BTTS
- [ ] Suitable corner state model

**Acceptance:** known fixtures return expected states.

## PHASE 8 — FALSE-ARB DETECTOR

- [ ] Mutual exclusivity
- [ ] Collective exhaustiveness
- [ ] Overlap detection
- [ ] Uncovered-state detection
- [ ] Both-loss detection
- [ ] Push/gap detection
- [ ] Human-readable rejection reason

**Acceptance:** known false arbs are rejected.

## PHASE 9 — STAKE OPTIMIZER

- [ ] Two-way
- [ ] Three-way
- [ ] Push-aware
- [ ] Half-settlement
- [ ] Multi-leg
- [ ] General maximin solver
- [ ] Minimum guaranteed return
- [ ] Guaranteed profit
- [ ] ROI
- [ ] Rounding tolerance
- [ ] Minimum stake constraints

**Acceptance:** simulated worst-case return matches optimizer output.

## PHASE 10 — CANDIDATE GENERATOR

- [ ] Same-market cross-book
- [ ] Complementary markets
- [ ] Asian-line candidates
- [ ] Team-total/match-total
- [ ] Multi-leg partitions
- [ ] Protected handicap structures
- [ ] Candidate pruning

**Acceptance:** known arbs found and known false arbs rejected.

## PHASE 11 — VALIDATION

- [ ] Freshness threshold
- [ ] Provider/source status
- [ ] Settlement confidence
- [ ] Event confidence
- [ ] Price age
- [ ] Cross-source timestamp consistency
- [ ] Final recheck
- [ ] Theoretical vs verified status

**Acceptance:** stale/uncertain opportunities cannot be marked verified.

## PHASE 12 — API

- [ ] Authentication
- [ ] Events
- [ ] Markets
- [ ] Odds
- [ ] Opportunities
- [ ] Opportunity details
- [ ] Provider health
- [ ] Scanner status
- [ ] Admin
- [ ] Pagination/filtering
- [ ] OpenAPI contract

**Acceptance:** integration tests pass.

## PHASE 13 — DASHBOARD

- [ ] 22_VOID branding
- [ ] Live opportunities
- [ ] Filters
- [ ] Event detail
- [ ] Market matrix
- [ ] Bookmaker comparison
- [ ] Stake calculator
- [ ] Guaranteed return
- [ ] Settlement explanation
- [ ] Why-arb explanation
- [ ] Why-rejected explanation
- [ ] Freshness
- [ ] Provider health
- [ ] Scanner heartbeat

**Acceptance:** complete opportunity inspection flow works.

## PHASE 14 — WORKERS

- [ ] Scheduled polling
- [ ] Rate limiter
- [ ] Retry/backoff
- [ ] Raw payload capture
- [ ] Normalize job
- [ ] Detection job
- [ ] Persistence job
- [ ] Heartbeat
- [ ] Failure recovery

**Acceptance:** transient provider failures recover.

## PHASE 15 — HISTORY

- [ ] Odds snapshots
- [ ] Opportunity snapshots
- [ ] Disappearance time
- [ ] Price movement
- [ ] Source latency
- [ ] Arb duration
- [ ] False-positive analysis

**Acceptance:** historical opportunities can be reconstructed.

## PHASE 16 — SECURITY

- [ ] Secrets server-side
- [ ] Auth/authorization
- [ ] Rate limiting
- [ ] Input validation
- [ ] Security headers
- [ ] Audit logs
- [ ] Dependency audit
- [ ] Provider terms review

**Acceptance:** security checklist passes.

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

- 2026-09-17 (Phase 0): Repo moved from OneDrive to `C:\Users\User\Documents\22_VOID`; git kept on `main`. Monorepo created with npm workspaces (`apps/web`, 8 `packages/*`, `workers/odds-collector`). Root tooling: ESLint 10 flat config, Prettier, `tsconfig.base.json`, `.env.example`, `.editorconfig`, `.gitignore`. Package seeds: `@22void/shared` (zod schemas, odds validators) and `@22void/domain` (canonical enums) implemented; six engine packages are compilable skeletons preserving module boundaries. Web app: Next.js 16.3.5 + Tailwind v4 + shadcn/ui + brand landing page + vitest + Playwright smoke. Docker compose (postgres 16) validated. Docs: PROJECT_STATE.md, TECH_STACK.md, BUILD_AGENT_PROMPT.md, docs/ARBITRAGE_ENGINE_SPEC.md, docs/ARCHITECTURE.md, README.md. Automation: `scripts/project-state-check.ts` and GitHub Actions CI. Gate green: lint, typecheck, 10/10 tests, build, e2e. Engines upgraded to Node 24 LTS (portable) because vite 8/vitest 4/eslint 10 require >=22.13.