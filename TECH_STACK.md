# 22_VOID — TECH STACK

Version: 1.0 | 2026-09-17

## Product

Cloud-hosted, football-first sports-arbitrage research/detection platform. Browser is the client; collectors, database, normalization, settlement, outcome analysis and arbitrage engine run in the cloud.

## Stack

- Language: TypeScript
- Frontend: Next.js + React
- UI: Tailwind CSS + shadcn/ui
- Validation: Zod
- Backend: Next.js Route Handlers initially
- Workers: Node.js/TypeScript
- Database: PostgreSQL
- Managed DB/Auth: Supabase initially
- ORM: Prisma
- Cache/queue: Redis-compatible service later
- Web deployment: Vercel initially
- Persistent workers: Railway/Render/Fly.io or equivalent when needed
- Tests: Vitest + Playwright
- API contract: OpenAPI
- Containers: Docker
- Source control/CI: Git + GitHub + GitHub Actions
- Monitoring: Sentry + provider logs
- Secrets: hosting secret manager; never frontend

## Data-provider strategy

Do NOT integrate 60 individual bookmaker APIs initially.

Prototype candidates:

1. ParlayAPI: current published free tier = 1,000 credits/month, no card, 30+ sportsbooks advertised.
2. Odds-API.io: current published free tier = 100 requests/hour, 500/day, 2 recreational bookmakers; its free tier is for development/testing and commercial production requires upgrade.

Provider choice remains provisional until we verify football, relevant bookmakers, Asian totals/handicaps, team totals, corners/cards, timestamps, Kenya/use restrictions, redistribution rights and rate limits.

All providers sit behind an adapter interface so the core engine is provider-independent.

## Core domain

**Event:** sport, competition, start_time, home_team, away_team, canonical_event_id, source_event_ids

**Market:** event_id, period, market_family, market_type, line, settlement_rule_version

**Selection/Odds:** market_id, outcome, odds, source/bookmaker, observed_at, source_updated_at, freshness

## Settlement

Support:

```text
FULL_WIN, FULL_LOSS, PUSH, HALF_WIN, HALF_LOSS, VOID
```

Decimal settlement:

```text
full win  = stake * odds
push      = stake
half win  = stake * (odds + 1) / 2
half loss = stake / 2
loss      = 0
void      = stake
```

Never classify an arb from reciprocal sums alone.

## Arbitrage pipeline

```text
INGEST → VALIDATE → NORMALIZE → MATCH EVENTS → NORMALIZE MARKETS
→ VERIFY SETTLEMENT → GENERATE STATES → BUILD PAYOFF MATRIX
→ VERIFY COVERAGE → OPTIMIZE STAKES → CALCULATE MIN RETURN
→ FRESHNESS CHECK → PERSIST → DISPLAY
```

General optimizer:

```text
maximize minimum portfolio return subject to total stakes = T and stakes >= 0.
```

A guaranteed-profit arb requires `minimum_return > T`.

## Security

- API keys server-side only.
- Validate external data with Zod.
- Rate-limit public APIs.
- Audit configuration changes.
- Never bypass bookmaker CAPTCHA, bot detection, authentication, geo controls, rate limits or access controls.
- Use permitted/authorized data sources.

## Architecture

```text
Browser → Next.js → Application API → PostgreSQL

Background:
Odds Provider → Adapter → Raw Odds → Normalizer
→ Event/Market DB → Settlement/State Engine → Arbitrage Engine → Opportunities
```

## Development stages

- A. Local foundation
- B. Free/low-cost cloud prototype
- C. Persistent worker + cache/queue when needed
- D. Monitoring/backups
- E. Multi-provider and multi-sport scaling