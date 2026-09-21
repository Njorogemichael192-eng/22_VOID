# 22_VOID

Cloud-hosted, football-first sports-arbitrage detection platform.

No opportunity is ever classified as an arbitrage from `sum(1/odds) < 1` alone. Every candidate is proven against a settlement-state model: identical event → verified settlement rules → complete outcome coverage → optimized stakes → positive worst-case return → fresh, rechecked prices.

## Repo layout

```text
apps/web                 Next.js 16 dashboard (Tailwind v4 + shadcn/ui)
packages/
  shared                 shared helpers (zod schemas, math, time)
  domain                 canonical domain model: events, markets, selections, odds, freshness, settlement (Phase 2)
  provider-contracts     OddsProvider interface + adapters (Phase 3)
  normalization          event + market normalization (Phases 4–5)
  settlement             settlement engine (Phase 6)
  outcome-engine         football state engine (Phase 7)
  arbitrage              detector + optimizer (Phases 8–9)
  db                     Prisma client access layer (Phase 1)
workers/odds-collector   scheduled collection worker (Phase 14)
prisma/                  schema + migrations (Phase 1)
docs/                    engine spec, architecture
scripts/                 project-state automation
```

## Requirements

- Node.js **>= 22.13** (vite 8 / vitest 4 / eslint 10 require it). Tested on Node 24 LTS and npm 11.
- npm 10+ (workspaces).
- Docker (local Postgres for Phase 1).

## Getting started

```bash
npm ci
cp .env.example .env       # fill secrets server-side only

docker compose up -d       # local PostgreSQL 16
npm run db:migrate         # first time: creates + applies prisma/migrations

npm run typecheck
npm test
npm run build
npm run dev                # https://localhost:3000
```

E2E (after `npm ci`):

```bash
npx playwright install chromium
npm run test:e2e --workspace @22void/web
```

## Scripts (root)

| Script | Action |
|---|---|
| `npm run dev` | Run the web app |
| `npm run build` | Build all workspaces |
| `npm test` | Test all workspaces |
| `npm run lint` | ESLint (flat config) |
| `npm run typecheck` | `tsc --noEmit` across workspaces |
| `npm run format` | Prettier write |
| `npm run state:check` | Validate PROJECT_STATE.md structure |
| `npm run db:generate` | Generate the Prisma client |
| `npm run db:migrate` | `prisma migrate dev` (create/apply dev migrations) |
| `npm run db:deploy` | `prisma migrate deploy` (apply committed migrations, CI-safe) |
| `npm run db:test` | CRUD integration tests for the `@22void/db` package |

## Design documents

- `PROJECT_STATE.md` — master TODO, per-phase acceptance, changelog, next action.
- `TECH_STACK.md` — technology choices and provider strategy.
- `BUILD_AGENT_PROMPT.md` — the building-agent master prompt.
- `docs/ARBITRAGE_ENGINE_SPEC.md` — the core engineering specification.
- `docs/ARCHITECTURE.md` — module boundaries and data flow.

## Status

Phase 2 (Domain model) complete — see `PROJECT_STATE.md` for evidence and the next action (Phase 3 — Provider).