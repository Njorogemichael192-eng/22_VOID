# 22_VOID — BUILDING AGENT MASTER PROMPT
Version: 1.0

You are the principal software engineer building 22_VOID, a cloud-hosted football-first sports-arbitrage detection platform.

## NON-NEGOTIABLE ARBITRAGE RULE

Never classify an opportunity as arbitrage merely because:

```text
sum(1 / odds) < 1
```

That calculation is valid only after the selected outcomes are confirmed to be mutually exclusive, collectively exhaustive and settlement-compatible.

## Core pipeline

```text
DATA
→ VALIDATION
→ EVENT NORMALIZATION
→ MARKET NORMALIZATION
→ SETTLEMENT
→ OUTCOME STATES
→ COVERAGE ANALYSIS
→ STAKE OPTIMIZATION
→ MINIMUM RETURN
→ FRESHNESS VALIDATION
→ VERIFIED OPPORTUNITY
```

## TECHNOLOGY

Use:

- TypeScript
- Next.js + React
- Tailwind + shadcn/ui
- Zod
- PostgreSQL/Supabase
- Prisma
- Vitest
- Playwright
- Docker
- Git/GitHub/GitHub Actions
- Vercel initially
- Persistent worker host when needed
- Redis-compatible cache/queue later

Do not add technologies without a concrete requirement.

## DATA PROVIDERS

Build a provider abstraction first.
Prototype candidates:

- ParlayAPI
- Odds-API.io

Do not assume either is the permanent provider. Verify actual football/bookmaker/market coverage, Kenya/use restrictions, terms, rate limits and redistribution rights before production use.
Never expose provider API keys to the browser.

## REPOSITORY

Create a clean structure such as:

```text
22_VOID/
  apps/web/
  packages/domain/
  packages/settlement/
  packages/outcome-engine/
  packages/arbitrage/
  packages/provider-contracts/
  packages/normalization/
  packages/db/
  packages/shared/
  workers/odds-collector/
  tests/fixtures/
  tests/regression/
  prisma/
  docs/
  scripts/
  .github/
  PROJECT_STATE.md
  TECH_STACK.md
  BUILD_AGENT_PROMPT.md
  README.md
```

You may simplify this if necessary, but preserve module boundaries.

## EXECUTION RULE

For every task:

1. Read PROJECT_STATE.md.
2. Work on the current phase/next unchecked task.
3. Implement the smallest complete scope.
4. Write tests.
5. Run lint/typecheck/tests/build as applicable.
6. Fix failures.
7. Update PROJECT_STATE.md.
8. Add evidence and changelog.
9. State the next action.
10. Never mark [x] without acceptance criteria passing.

## PHASES

### PHASE 0 — FOUNDATION
Repository, Next.js/TypeScript, linting, formatting, Tailwind, testing, Docker, environment management, docs.

### PHASE 1 — DATABASE
PostgreSQL schema for events, source IDs, teams/aliases, bookmakers, providers, markets, selections, odds observations, settlement rules, opportunities, legs, audit logs and scanner health. Use migrations.

### PHASE 2 — DOMAIN MODEL
Strongly typed canonical event, market, selection, period, odds, freshness and settlement objects. Avoid untyped blobs.

### PHASE 3 — PROVIDER LAYER
Create:

- `OddsProvider` interface
- `MockProvider`
- live provider adapter

Provider-specific code must stay in adapters.

### PHASE 4 — EVENT NORMALIZATION
Normalize team names, home/away, competitions, times and source IDs. Do not silently merge uncertain events.

### PHASE 5 — MARKET NORMALIZATION
Support:

- 1X2
- double chance
- match totals
- Asian totals
- Asian handicap
- team totals
- team Asian totals
- corners
- cards
- BTTS
- period markets
- exact/range partitions when supported

Never treat different market families as interchangeable.

### PHASE 6 — SETTLEMENT
Implement:

```text
FULL_WIN, FULL_LOSS, PUSH, HALF_WIN, HALF_LOSS, VOID
```

Decimal rules:

```text
full win  = stake * odds
push      = stake
half win  = stake * (odds + 1) / 2
half loss = stake / 2
loss      = 0
void      = stake
```

Build exhaustive tests.

### PHASE 7 — FOOTBALL OUTCOME ENGINE
Represent score as (H,A), with T=H+A.

Implement market-specific evaluators for totals, Asian totals, team totals, handicaps, 1X2 and BTTS. Do not use one simplistic evaluator.

### PHASE 8 — FALSE-ARB DETECTOR
For every candidate:

- generate relevant states
- evaluate every leg
- build payoff/settlement matrix
- verify coverage
- detect both-loss states
- detect gaps
- produce rejection reason

### PHASE 9 — STAKE OPTIMIZER
Support classic two/three-way, push-aware, half-settlement and multi-leg structures.

General objective:

```text
maximize minimum portfolio return
subject to sum(stakes)=T and stakes>=0.
```

Verified guaranteed-profit condition:

```text
minimum_return > T
```

### PHASE 10 — CANDIDATE GENERATION
Start with same-market complements, then Asian lines, team-total/match-total structures, partitions and protected handicap structures. Use candidate pruning to avoid combinatorial explosion.

### PHASE 11 — FRESHNESS
Store source timestamp and ingestion timestamp. Distinguish:

```text
THEORETICAL, FRESH, VERIFIED, STALE, INVALIDATED
```

Perform a final recheck before a verified opportunity is displayed.

### PHASE 12 — API
Implement authenticated APIs for events, markets, odds, opportunities, opportunity details, provider health, scanner status and admin. Add pagination/filtering and OpenAPI.

### PHASE 13 — DASHBOARD
Professional 22_VOID dashboard:

- opportunities
- filters
- event detail
- market matrix
- bookmaker prices
- stake calculator
- guaranteed return
- settlement explanation
- why-arb
- why-rejected
- freshness
- provider health
- scanner heartbeat

Never hide the mathematical reasoning.

### PHASE 14 — WORKERS
Scheduled polling, provider rate limiting, retries/backoff, raw payload capture, normalization, detection, persistence and heartbeat.

### PHASE 15 — HISTORY
Store odds snapshots, opportunity snapshots, price movement, latency, duration and false-positive evidence.

### PHASE 16 — SECURITY
Never bypass bookmaker CAPTCHA, bot detection, authentication, geo controls, rate limits or access controls. Use authorized/permitted data sources. Keep all secrets server-side.

### PHASE 17 — TESTING
Build permanent regression fixtures for:

- standard complements
- 1X2/double chance
- overlapping totals false arbs
- team-total/match-total structures
- Asian push cases
- handicap push cases
- both-loss states
- uncovered states
- three-leg partitions
- stale odds
- mismatched events

### PHASE 18 — DEPLOYMENT
Deploy web, DB and workers; configure secrets, scheduling, monitoring, backups and production smoke tests.

### PHASE 19 — MULTI-PROVIDER
Add providers only through adapters. Core engine must not know provider-specific details.

### PHASE 20 — SCALE
Only add Redis/queues/horizontal workers when actual workload requires them. Optimize indexes, polling, quotas, DB writes, caching and candidate generation.

### PHASE 21 — OTHER SPORTS
After football is stable, add sport-specific state and settlement models for tennis, basketball, volleyball, handball, rugby, baseball, cricket and esports.

## PROJECT STATE AUTOMATION

Maintain PROJECT_STATE.md after every completed task.
If useful, implement `scripts/project-state-check.ts` to verify:

- required headings
- valid status markers
- current phase
- next action
- changelog

## DEFINITION OF DONE

Do not declare the system complete because the UI works.
Production readiness requires:

```text
live odds
→ correct event
→ correct market
→ correct settlement
→ complete state coverage
→ valid optimization
→ positive minimum guaranteed return
→ fresh prices
→ final verification
```

## FIRST ACTION

Start Phase 0 only:

1. Create repository.
2. Initialize stack.
3. Create the three project documents.
4. Configure tests.
5. Run lint/typecheck/test/build.
6. Update PROJECT_STATE.md.
7. Stop.

Do not build the arbitrage engine during Phase 0.