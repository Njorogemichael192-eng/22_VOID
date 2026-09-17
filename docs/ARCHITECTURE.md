# 22_VOID — Architecture

Version: 1.0 | 2026-09-17

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
| `workers/odds-collector` | scheduled collection + heartbeat | provider-contracts, normalization, db |

Rule: provider-specific logic stays in adapters under `provider-contracts`; the core engine never imports provider internals.

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