# 22_VOID — Deployment Runbook (Phase 18)

Production deployment for the 22_VOID stack: **web** (Next.js standalone), **worker**
(odds collector), **PostgreSQL**, **backups**, optional **Caddy** TLS front, and a
**production smoke test** for verification. Local `node`/`npm` are not needed on the
target host — everything runs in Docker.

Reference architecture: `docs/ARCHITECTURE.md`. Plans live in `PROJECT_STATE.md`
(Phase 18 checklist + acceptance: *production health checks green*).

---

## 1. Checklist at a glance

| Phase 18 item | Delivered by | Verified how |
| --- | --- | --- |
| Web deployment | `infra/Dockerfile.web` + `web` service | smoke: `/api/v1/health`, 200 ok |
| Database | `db` service (`postgres:16`) + `prisma migrate deploy` entrypoint | `pg_isready` healthcheck |
| Worker | `infra/Dockerfile.worker` + `worker` service | `/healthz`, `docker compose ps` |
| Secrets | `infra/env.prod.example` → `infra/.env.prod` (gitignored) | `security:scan` + secret-scan ci |
| Scheduler | worker `SCANNER_POLL_INTERVAL_MS` loop + backup cron sidecar | scanner freshness check |
| Monitoring | `/api/v1/health`, `/api/v1/scanner`, worker `/healthz`, compose healthchecks | `smoke:prod` |
| Backups | `backup` sidecar (`pg_dump` + retention + `status` file) | `restore.sh` docs |
| Domain | `infra/Caddyfile` + `compose.proxy.yml` (Let's Encrypt) | browse `https://DOMAIN` |
| Production smoke test | `scripts/smoke-prod.ts` (`npm run smoke:prod`) | exit code 0 |

---

## 2. Prerequisites

- Docker Engine 24+ and Docker Compose v2 (dev machine + target host).
- A host with public ports 80/443 (only if serving the Caddy proxy).
- Secrets ready (template in `infra/env.prod.example`): two Postgres credentials +
  either a real connection URL or a single `DATABASE_URL`; two API bearer tokens
  (`API_KEY`, `ADMIN_API_KEY`); an Odds API key if the worker uses the live provider.

---

## 3. Quickstart (production on a Docker host)

```sh
# 1) secrets
cp infra/env.prod.example infra/.env.prod
$EDITOR infra/.env.prod            # fill every value; gitignored

# 2) validate the merged config (catches missing ${VARS} before anything runs)
docker compose --env-file infra/.env.prod -f infra/compose.prod.yml config

# 3) build + boot
docker compose --env-file infra/.env.prod -f infra/compose.prod.yml up -d --build
docker compose --env-file infra/.env.prod -f infra/compose.prod.yml ps

# 4) optional TLS/domain front (only after DNS A-record points at this host)
docker compose --env-file infra/.env.prod -f infra/compose.prod.yml \
  -f infra/compose.proxy.yml up -d

# 5) verify
curl -s http://127.0.0.1:3000/api/v1/health
SMOKE_BASE_URL=http://127.0.0.1:3000 SMOKE_API_KEY=$API_KEY \
  SMOKE_REQUIRE_SCANNER=true npm run smoke:prod
```

First boot runs `prisma migrate deploy` once (`RUN_MIGRATIONS=true` in the template).
Set it to `false` afterward — deploys must not race migrations on every restart.

---

## 4. Service reference

### Environment variables (shared `infra/.env.prod`)

| Variable | Applies to | Required | Notes |
| --- | --- | --- | --- |
| `POSTGRES_USER/PASSWORD/DB` | db | yes | create the role+database |
| `DATABASE_URL` | web, worker | yes | `postgresql://u:p@db:5432/db` |
| `DASHBOARD_SOURCE` | web | prod `db` | `demo` serves fixtures (smoke only) |
| `API_KEY`, `ADMIN_API_KEY` | web | yes | bearer tokens; missing → API fails closed 401 |
| `RUN_MIGRATIONS` | web | first boot `true` | afterwards `false` |
| `WORKER_PROVIDER` | worker | `odds-api` (or `mock`) | |
| `ODDS_API_KEY`, `ODDS_API_BASE_URL` | worker | for live provider | |
| `SCANNER_POLL_INTERVAL_MS` | worker | default 15000 | cycle length (the "scheduler") |
| `RATE_LIMIT_CAPACITY` / `RATE_LIMIT_REFILL_PER_SECOND` | worker | optional | token bucket |
| `BACKUP_RETENTION_DAYS`, `BACKUP_SCHEDULE` | backup | default 14 / `0 2 * * *` | cron (UTC) |
| `DOMAIN`, `ACME_EMAIL` | caddy | for TLS | empty `DOMAIN` → plain HTTP :80 |

### Health endpoints (monitoring)

| Endpoint | Auth | Meaning |
| --- | --- | --- |
| `GET /api/v1/health` | none | liveness; `{"status":"ok"}` |
| `GET /api/v1/scanner` | `Authorization: Bearer $API_KEY` | scanner run history + `overall.freshness` (stale > 5 min) |
| `GET /api/v1/providers` | `Authorization: Bearer $API_KEY` | per-source ingestion status |
| worker `GET /healthz` (`WORKER_HEALTH_PORT`, default 8081) | none | worker liveness, `lastCycleAt`, `lastCycleStatus`, `runCount` |

### Scheduler

- **Scan loop**: the worker cycles every `SCANNER_POLL_INTERVAL_MS` via its own
  native scheduler (`nativeScheduler` in `workers/odds-collector/src/runtime.ts`).
  No external cron is needed for collection.
- **Backups**: the `backup` container runs `pg_dump` once at boot, then on
  `BACKUP_SCHEDULE` (a daily UTC cron) — retention handled by `backup.sh`.

---

## 5. Monitoring

- **Container healthchecks** (compose): `db` → `pg_isready`; `web` → fetches
  `/api/v1/health`; `worker` → fetches `/healthz`. `restart: unless-stopped`
  recycles any unhealthy container.
- **External uptime** (recommended): poll `GET /api/v1/health` and the worker
  `/healthz` (expose both to your monitor) every 1–5 min.
- **Freshness**: `GET /api/v1/scanner` exposes `overall.lastRunAt`/`overall.status`;
  the app flags runs older than 5 minutes as `stale`. Alert when `overall.stale`
  is non-null (worker down, provider failing, or scheduler stalled).
- **Backup liveness**: `docker compose exec backup cat /backups/status` shows the
  last dump (`OK <timestamp>` = green, `FAILED ...` = alert). Send that file's
  mtime/content to your monitor out of band.
- **Logs**: `docker compose ... logs -f --tail=200 web` / `worker`; worker cycles
  log a one-line summary (`[odds-collector] ok …`).

---

## 6. Backups & restore

```sh
# on-demand backup
docker compose exec -T backup /usr/local/bin/backup.sh

# list dumps + status (status readable for monitoring)
docker compose exec backup sh -c 'cat /backups/status; ls -lh /backups'

# restore (DESTRUCTIVE — replaces target DB contents)
docker compose exec -T backup restore.sh /backups/void-20260924T020000Z.dump
```

Backups live in `infra/backups/` on the host (a named volume would be an
alternative). Off-site/object storage sync of `infra/backups/` is an operator choice
(the bundle keeps it a thin, standard pg_dump format precisely so shipping is easy).

---

## 7. Deploy & rollback

```sh
# rebuild + restart with new images (zero-schema-change deploys)
docker compose --env-file infra/.env.prod -f infra/compose.prod.yml up -d --build web worker

# after a schema change: run migrations, then roll forward
docker compose --env-file infra/.env.prod -f infra/compose.prod.yml run --rm web \
  sh -c 'RUN_MIGRATIONS=true docker-entrypoint.sh'   # or exec prisma migrate deploy
```

Rollback = re-point to the previous `docker compose up` (compose keeps prior image
until rebuilt). With `infra/backups/` a point-in-time DB restore is one command
(section 6). No blue/green or canary tooling ships in this bundle by design —
documented deployment teaching lives here, automation can layer on top.

---

## 8. Vercel alternative (managed Next.js)

`apps/web` is Vercel-ready without the compose `web` service:

- Connect the repo in Vercel → framework Next.js; root dir `apps/web`.
- Env vars: `DATABASE_URL` (point at the compose `db` or Supabase/Neon URI — see
  `docs/ARCHITECTURE.md`'s Supabase note), `DASHBOARD_SOURCE=db`, `API_KEY`,
  `ADMIN_API_KEY`.
- The worker + backups still need a host: run `infra/Dockerfile.worker` + `backup`
  (optionally from the same Docker host, with `infra/compose.prod.yml` minus `web`).
- Builds happen in Vercel's cloud; `DB_EXPOSE_PORT`/`WEB_PORT` and `RUN_MIGRATIONS`
  are irrelevant there. Keep `RUN_MIGRATIONS=false` and run migrations from release
  via `npx prisma migrate deploy`.

---

## 9. Local verification (before touching production)

```sh
# (a) compose files are syntactically valid / var-complete
docker compose --env-file infra/env.prod.example -f infra/compose.prod.yml config -q

# (b) images build on this machine
docker compose --env-file infra/env.prod.example -f infra/compose.prod.yml build

# (c) smoke test against a locally running built web (demo data)
npm run build --workspace @22void/web
cross-platform note: start `PORT=3900 DASHBOARD_SOURCE=demo npm run start --workspace @22void/web`
SMOKE_BASE_URL=http://127.0.0.1:3900 SMOKE_API_KEY=dev-key SMOKE_REQUIRE_SCANNER=false \
  npm run smoke:prod     # expect: SMOKE PASSED

# (d) full gate
npm run lint && npm run typecheck && npm test && npm run build && npm run state:check
```

`SMOKE_REQUIRE_SCANNER=true` additionally asserts the worker→DB→API path is green,
so run it against any stack where the worker is collecting.