# 22_VOID — Deployment Runbook (Phase 18)

Production deployment for the 22_VOID stack: **web** (Next.js standalone), **worker**
(odds collector), **PostgreSQL**, **backups**, optional **Caddy** TLS front, and a
**production smoke test** for verification. The stack itself runs entirely in
Docker, but the smoke test is **not** containerised: `npm run smoke:prod` runs
`scripts/smoke-prod.ts` through `tsx` on whatever machine invokes it, pointed at
the deployed URL. So the _target_ host needs Node 22 + npm (or a checkout of the
repo from which to run it) if you want to verify the stack in place; only
Docker is required to _run_ the stack.

Reference architecture: `docs/ARCHITECTURE.md`. Plans live in `PROJECT_STATE.md`
(Phase 18 checklist + acceptance: _production health checks green_).

---

## 1. Checklist at a glance

| Phase 18 item         | Delivered by                                                                           | Verified how                     |
| --------------------- | -------------------------------------------------------------------------------------- | -------------------------------- |
| Web deployment        | `infra/Dockerfile.web` + `web` service                                                 | smoke: `/api/v1/health`, 200 ok  |
| Database              | `db` service (`postgres:16`) + one-shot `migrate` service (`infra/scripts/migrate.sh`) | `pg_isready` healthcheck         |
| Worker                | `infra/Dockerfile.worker` + `worker` service                                           | `/healthz`, `docker compose ps`  |
| Secrets               | `infra/env.prod.example` → `infra/.env.prod` (gitignored)                              | `security:scan` + secret-scan ci |
| Scheduler             | worker `SCANNER_POLL_INTERVAL_MS` loop + backup cron sidecar                           | scanner freshness check          |
| Monitoring            | `/api/v1/health`, `/api/v1/scanner`, worker `/healthz`, compose healthchecks           | `smoke:prod`                     |
| Backups               | `backup` sidecar (`pg_dump` + retention + `status` file)                               | `restore.sh` docs                |
| Domain                | `infra/Caddyfile` + `compose.proxy.yml` (Let's Encrypt)                                | browse `https://DOMAIN`          |
| Production smoke test | `scripts/smoke-prod.ts` (`npm run smoke:prod`)                                         | exit code 0                      |

---

## 2. Prerequisites

- Docker Engine 24+ and Docker Compose v2 (dev machine + target host).
- A host with public ports 80/443 (only if serving the Caddy proxy).
- Secrets ready (template in `infra/env.prod.example`): two Postgres credentials +
  either a real connection URL or a single `DATABASE_URL`; two API keys sent as
  `x-api-key` (`API_KEY`, `ADMIN_API_KEY`); an Odds API key if the worker uses the
  live provider.

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

Migrations are **not** a `web` boot flag. `infra/compose.prod.yml` defines a
one-shot `migrate` service running `infra/scripts/migrate.sh`
(`prisma migrate deploy`), and both `web` and `worker` declare:

```yaml
depends_on:
  migrate:
    condition: service_completed_successfully
```

So a failed migration blocks the deploy rather than leaving a new image running
against an old schema. It is idempotent, so it is correct to let it run on every
`up` — there is no variable to set to `false` afterwards. To run it on its own:

```sh
docker compose --env-file infra/.env.prod -f infra/compose.prod.yml run --rm migrate
```

---

## 4. Service reference

### Environment variables (shared `infra/.env.prod`)

| Variable                                                       | Applies to  | Required                         | Notes                                                                                                             |
| -------------------------------------------------------------- | ----------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_USER/PASSWORD/DB`                                    | db          | yes                              | create the role+database                                                                                          |
| `DATABASE_URL`                                                 | web, worker | yes                              | `postgresql://u:p@db:5432/db`                                                                                     |
| `DASHBOARD_SOURCE`                                             | web         | yes (`db`)                       | the entrypoint validator fails startup unless it is exactly `db`; `demo` serves the fixture repo (e2e/smoke only) |
| `API_KEY`, `ADMIN_API_KEY`                                     | web         | yes                              | sent as the `x-api-key` header, **not** `Authorization: Bearer`; missing → API fails closed 401                   |
| `WORKER_PROVIDER`                                              | worker      | `odds-api`                       | required in production; `mock` is **refused** (see below)                                                         |
| `ALLOW_MOCK_PROVIDER_IN_PRODUCTION`                            | worker      | unset                            | demo escape hatch for the refusal; leave empty on a real stack                                                    |
| `ODDS_API_KEY`, `ODDS_API_BASE_URL`                            | worker      | for live provider                | required when `WORKER_PROVIDER=odds-api`; the base URL **must be `https://`**                                     |
| `ODDS_API_AUTH_IN_QUERY`                                       | worker      | unset                            | escape hatch that sends the key as `?apiKey=`; leave empty (see below)                                            |
| `ODDS_API_REGIONS`, `ODDS_API_MARKETS`, `ODDS_API_SPORT`       | worker      | see `env.prod.example`           | narrow what each poll asks for; the credit cost of a poll is **regions x markets**                                |
| `SCANNER_POLL_INTERVAL_MS`                                     | worker      | default 15000                    | cycle length (the "scheduler"); **must not exceed `WORKER_STALENESS_MS`** - see below                             |
| `API_RATE_LIMIT_CAPACITY` / `API_RATE_LIMIT_REFILL_PER_SECOND` | web         | 120 / 2                          | the public API's per-caller token bucket (429 + `Retry-After`)                                                    |
| `RATE_LIMIT_CAPACITY` / `RATE_LIMIT_REFILL_PER_SECOND`         | worker      | 10 / 5                           | token bucket for the worker's outbound provider calls                                                             |
| `BACKUP_RETENTION_DAYS`, `BACKUP_SCHEDULE`                     | backup      | default 14 / `0 2 * * *`         | cron (UTC)                                                                                                        |
| `BACKUP_REQUIRE_OFFSITE`                                       | backup      | **`true`** in `env.prod.example` | refuses to start without a usable offsite destination                                                             |
| `BACKUP_EXPECTED_HOST`                                         | backup      | `db`                             | `DATABASE_URL` host must match, or the run aborts                                                                 |
| `BACKUP_WATCHDOG_INTERVAL_SECONDS`                             | backup      | 60                               | self-supervision probe interval                                                                                   |
| `BACKUP_WATCHDOG_MAX_FAILURES`                                 | backup      | 3                                | consecutive probe failures before a restart                                                                       |
| `BACKUP_WATCHDOG_STALE_SECONDS`                                | backup      | `BACKUP_MAX_AGE_SECONDS`         | "no run of any outcome for this long" = wedged                                                                    |
| `BACKUP_WATCHDOG_ENABLED`                                      | backup      | `true`                           | `false` puts `crond` back at PID 1, no self-healing                                                               |
| `DOMAIN`, `ACME_EMAIL`                                         | caddy       | **yes**                          | no plain-HTTP fallback exists; see below                                                                          |

#### `DOMAIN` and `ACME_EMAIL` are mandatory

There is no "empty `DOMAIN` → plain HTTP on :80" mode. The proxy's entrypoint is
`infra/scripts/validate-proxy-env.sh`, which validates and then `exec`s caddy, and
`infra/compose.proxy.yml` additionally fails interpolation when either is unset
(`${DOMAIN:?…}`). The validator refuses:

- `DOMAIN` empty, longer than 253 characters, a single-label name, or one with
  invalid/leading/trailing-hyphen labels — it must be a real FQDN;
- any `placeholder`-shaped value (`example.com`, `replace-with…`, `change-me`, …)
  for either variable, so a copied template cannot boot a half-configured proxy;
- `ACME_EMAIL` empty, placeholder, whitespace/slash/backslash-bearing, or not of
  the form `something@host.tld` — Let's Encrypt needs a real contact address.

The failure is at startup with `proxy environment validation failed: <reason>`,
not at the first TLS handshake.

#### The provider key travels in a header, never in a URL

`ODDS_API_KEY` is sent as the `x-api-key` request header, matching the ParlayAPI
adapter. It used to be sent as `?apiKey=`, which is a materially weaker place to
put a live credential:

- **Every intermediary sees it.** A query string is recorded verbatim in the
  access logs of each proxy, load balancer and CDN hop between this container and
  the provider. A header is not.
- **It reaches the logs here too.** Any error that echoes the request URL carries
  the key with it, and the worker's cycle handler prints cycle errors to
  `docker compose logs`. The Odds API adapter is the only one that did this; the
  redaction that was supposed to catch it was a denylist for one hardcoded
  parameter name, so it only ever protected the exact spelling it knew about and
  let `apikey=`, `api_key=` or `token=` straight through. Query strings are now
  dropped from error messages entirely rather than filtered by name.

`ODDS_API_BASE_URL` must be `https://` in production; `http://` is refused,
because the key rides on every request. It is allowed outside production for a
local stub. Two related shapes are refused everywhere, since neither is ever
legitimate and both put a credential in the URL: embedded `user:password@`
userinfo, and a credential-looking query parameter (`apiKey`, `api_key`, `token`,
`key`, `sig`, …).

**`ODDS_API_AUTH_IN_QUERY=true`** is the escape hatch, for a provider that rejects
header auth. It restores the old `?apiKey=` behaviour and is wired through
`compose.prod.yml` so setting it has a predictable effect. A 401 or 403 while
using the header names this variable in the error, since the alternative — a key
that is simply wrong — looks identical from the outside. Leave it empty.

#### The mock provider cannot run in production

`MockProvider` fabricates every price it returns. Under `NODE_ENV=production` the
worker **refuses to start** on it and exits, because the failure it causes is
silent rather than loud: production also requires `DATABASE_URL`, so the store
resolves to Postgres, the synthetic prices are persisted, and they are then read
back and served through the API as real opportunities. Every cycle succeeds, the
worker's health stays green, and the dashboard shows tidy arbitrage that does not
exist. No log line, status code, or metric distinguishes that state from a working
collector — which is exactly why it is refused rather than warned about.

```sh
# Refused:
WORKER_PROVIDER=mock NODE_ENV=production
#   -> Refusing to run WORKER_PROVIDER=mock in production: it fabricates odds,
#      and with DATABASE_URL set those synthetic rows are persisted and served as
#      real opportunities. Set WORKER_PROVIDER=odds-api, or set
#      ALLOW_MOCK_PROVIDER_IN_PRODUCTION=true if this is deliberately a demo.
```

Two escape routes, both explicit:

- **`WORKER_PROVIDER=odds-api` with a real `ODDS_API_KEY`** — the correct fix.
- **`ALLOW_MOCK_PROVIDER_IN_PRODUCTION=true`** — for a demo or smoke test that
  wants production-shaped infrastructure (real Postgres, real migrations) without
  spending provider quota. The worker starts and prints a startup banner stating
  that every price, opportunity and arbitrage is invented and naming the store it
  is writing to. It is wired through `compose.prod.yml` so setting it in
  `.env.prod` does something predictable, and it is deliberately spelled out at
  length so it is greppable in an env file and in a shell history.

`WORKER_PROVIDER` must also be one of the two known values everywhere, not just in
production: an unrecognised value used to resolve to `mock` silently, so
`WORKER_PROVIDER=odds_api` in a developer's env file quietly served invented odds
instead of erroring. The default `mock` is unaffected outside production, where
`NODE_ENV` is not `production` — `npm test` and local runs are unaffected.

#### Rate limiting (two different limiters)

The two pairs above are not interchangeable, and confusing them was a real bug:
the `API_RATE_LIMIT_*` pair was missing from the web service entirely, so the only
limiter facing the internet ran on the in-code 120/2 default while an operator
tuned `RATE_LIMIT_CAPACITY` and saw the worker's provider polling change instead.

|               | `API_RATE_LIMIT_*` (web)          | `RATE_LIMIT_*` (worker)             |
| ------------- | --------------------------------- | ----------------------------------- |
| Guards        | inbound API requests from callers | outbound calls to the odds provider |
| On breach     | HTTP 429 + `Retry-After`          | the cycle waits for a token         |
| Configured in | `web.environment`                 | `worker.environment`                |

Three operational notes:

- **An unparseable value is fatal, not ignored.** `API_RATE_LIMIT_CAPACITY=120/min`
  stops the web container rather than silently reverting to 120. That is
  deliberate — a silently substituted default is how a limit ends up looser than
  intended with nothing in the logs.
- **The bucket is in-memory and per process.** It is correct for the single web
  container this compose file runs. Scale `web` to N replicas and the effective
  limit becomes N × configured, because each process keeps its own buckets. A
  shared store is the fix at that point (see `docs/ARCHITECTURE.md`).
- **The bucket key is the caller's address from `x-forwarded-for`**, so its
  trustworthiness is the proxy's. Keep the web port on loopback and let Caddy
  normalise the header, exactly as `/api/v1/ready` requires.

### Security headers at the edge (Caddy)

Caddy's `header` directive **replaces** any value the upstream already sent — it
does not merge. Every header listed in both `infra/Caddyfile` and
`apps/web/lib/security/headers.ts` is therefore one the edge can silently weaken,
and the edge wins.

The Content-Security-Policy is the sharpest case. The app sends a route-aware
policy: a page policy for documents, and `default-src 'none'; frame-ancestors
'none'; sandbox` for `/api/*`. A site-wide CSP at Caddy overwrote the API one, so
every JSON response went out advertising `script-src 'unsafe-inline'` and, more
seriously, no `sandbox` at all. The CSP is now scoped with `not path /api
/api/*`, so the app's own policy survives on the routes where it matters, and its
value for documents is byte-identical to the app's page policy so the override is
a no-op.

Two other duplicated headers were weaker at the edge and are now aligned with the
app: HSTS (`max-age=31536000` → `63072000`, matching `baseSecurityHeaders`) and
`Permissions-Policy`, which had dropped `interest-cohort=()`.

`apps/web/lib/security/security.test.ts` asserts all of this against the real
Caddyfile, so a duplicate header drifting from the app's value fails the build
rather than shipping.

### Health endpoints (monitoring)

| Endpoint                                                   | Auth                  | Meaning                                                                                                                                                                                                 |
| ---------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/health`                                       | none                  | liveness; `{"status":"ok"}`                                                                                                                                                                             |
| `GET /api/v1/ready`                                        | internal callers only | readiness; `200` only when `SELECT 1` against Postgres succeeds within 2s, else `503`. Caddy's active health check calls this every 30s, so it must stay reachable from the proxy — see the note below. |
| `GET /api/v1/scanner`                                      | `x-api-key: $API_KEY` | scanner run history + `overall.freshness` (stale > 5 min)                                                                                                                                               |
| `GET /api/v1/providers`                                    | `x-api-key: $API_KEY` | per-source ingestion status                                                                                                                                                                             |
| worker `GET /healthz` (`WORKER_HEALTH_PORT`, default 8081) | none                  | worker liveness, `lastCycleAt`, `lastCycleStatus`, `runCount`                                                                                                                                           |

#### Why `/api/v1/ready` is restricted

It is unauthenticated by necessity, and it touches the database, so open to the
internet it is both a liveness oracle and a probe amplifier. Three properties
keep that cost bounded:

- **Internal callers only.** The route reads the caller's address from
  `x-forwarded-for` / `x-real-ip` (nearest hop) and answers `403` unless it falls
  inside `READINESS_ALLOWED_CIDRS`, which defaults to loopback + RFC1918 +
  link-local + IPv6 ULA. Caddy probes over the Docker network, so the defaults
  fit the shipped topology. Set the variable if your proxy probes from a public
  address, or to `*` to disable the check.
- **The port stays on loopback.** `compose.prod.yml` publishes the web port on
  `127.0.0.1` only. The allowlist reads a header, and a header is only as
  trustworthy as the proxy in front of it; if you ever expose the container
  directly, restore a loopback bind or add a firewall rule first.
- **One cached probe, small pool.** The verdict is memoised for 5s, so a flood
  costs one probe, not one per request, and that probe reuses a single pool
  capped at 2 connections instead of building a fresh one per call.

#### Reading the worker's health

The worker serves three paths on `WORKER_HEALTH_PORT` (8081, internal only — the
compose file does not publish it): `/livez` (process is up), `/readyz`, and
`/healthz`. The healthcheck calls `/healthz` and requires `status: "ok"`, so the
status ladder matters:

| `status`                      | HTTP                        | Meaning                                                                              |
| ----------------------------- | --------------------------- | ------------------------------------------------------------------------------------ |
| `starting`                    | 200 during grace, 503 after | no cycle has landed yet; `ready` is true only inside `WORKER_STARTUP_GRACE_MS` (30s) |
| `ok`                          | 200                         | last cycle reported OK and is younger than `WORKER_STALENESS_MS` (5 min)             |
| `degraded` / `down` / `error` | 503                         | the last cycle said so                                                               |
| `stale`                       | 503                         | the last cycle is older than `WORKER_STALENESS_MS` — the wedge detector              |

Two consequences worth knowing before you touch the healthcheck:

- **`start_period` must exceed a real cold start** (120s here). Until the first
  cycle lands the status is `starting`, not `ok`, so a shorter window marks a
  healthy worker unhealthy — and nothing repairs it, because
  `restart: unless-stopped` restarts on _exit_, not on health. Treat an
  unhealthy worker as an alarm to investigate, not a self-healing condition; the
  backup sidecar is the piece that restarts itself.
- **The staleness ceiling is passed as the healthcheck's fifth argument**, not
  left to the `WORKER_STALENESS_MS` env fallback. The image does not set that
  variable, so relying on the fallback loses the age guard the moment the image
  runs outside this compose file.

The server also caps how long a stalled client can hold a connection
(`headersTimeout` 5s, `requestTimeout` 10s) and sends `cache-control: no-store`,
so a scraper that opens a socket and stops — or an intermediary that replays a
cached 200 — cannot keep reporting a wedged worker as healthy.

### Scheduler

- **Scan loop**: the worker cycles every `SCANNER_POLL_INTERVAL_MS` via its own
  native scheduler (`nativeScheduler` in `workers/odds-collector/src/runtime.ts`).
  No external cron is needed for collection.
- **Poll interval is coupled to the health ceiling**: raising
  `SCANNER_POLL_INTERVAL_MS` to conserve provider quota is an expected
  operation, and it drags the healthcheck with it. `SCANNER_POLL_INTERVAL_MS`
  **must not exceed `WORKER_STALENESS_MS`** (default `300000`), because health
  reports `stale` — and the container unhealthy — once the last completed cycle
  is older than `WORKER_STALENESS_MS`. Leave the interval high and the worker
  spends most of its life reporting stale while every log line claims success.
  Both a startup guard (`assertIntervalWithinStaleness` in
  `workers/odds-collector/src/config.ts`, called before the provider is built)
  and a pre-deploy check (`infra/scripts/validate-env.sh`) fail fast when the
  interval is the larger of the two, naming both values. The shipped defaults are
  `15000` / `300000`; the free-tier configuration documented in
  `infra/env.prod.example` is `5400000` / `10800000`.
- **Backups**: the `backup` container runs `pg_dump` once at boot, then on
  `BACKUP_SCHEDULE` (a daily UTC cron) — retention handled by `backup.sh`.
- **Backup supervision**: `backup-entrypoint.sh` backgrounds `crond` and runs the
  same probe as the healthcheck every `BACKUP_WATCHDOG_INTERVAL_SECONDS`
  (default 60), exiting non-zero after `BACKUP_WATCHDOG_MAX_FAILURES` (default 3)
  consecutive failures so `restart: unless-stopped` actually engages. It exits
  only when the container is genuinely **wedged**, meaning `crond` has died or no
  backup of _any_ outcome has run for `BACKUP_WATCHDOG_STALE_SECONDS` (defaults to
  `BACKUP_MAX_AGE_SECONDS`).

  It deliberately does **not** restart on a recent failed run. A `FAILED` status
  means the problem is a broken bucket, a revoked key or an unreachable database,
  and no restart cures those; bouncing the container would re-run the same doomed
  `pg_dump` about once a minute forever, turning one bad night into a permanent
  crash loop. A failed run is already reported in the `status` file and on the
  container's exit code, so it stays visible instead of being hidden behind
  restarts. Set `BACKUP_WATCHDOG_ENABLED=false` to disable (then `crond` runs as
  PID 1 and nothing self-heals).

---

## 5. Monitoring

- **Container healthchecks** (compose): `db` → `pg_isready`; `web` → fetches
  `/api/v1/health`; `worker` → fetches `/healthz`; `backup` → `backup-health.sh`
  (last run OK, within `BACKUP_MAX_AGE_SECONDS`, target still reachable).
  **`restart: unless-stopped` does _not_ recycle an unhealthy container** — it
  only acts when the main process exits, and a healthcheck result is just a
  status bit. A sidecar whose `crond` had died therefore stayed `running` +
  `unhealthy` indefinitely, producing no backups while `docker compose ps` still
  looked healthy. The `backup` service supervises itself to close that gap (see
  §4 Scheduler); `web`/`worker` still need an external monitor or an
  `autoheal`-style reaper to be recycled on health failure.
- **External uptime** (recommended): poll `GET /api/v1/health` and the worker
  `/healthz` (expose both to your monitor) every 1–5 min.
- **Freshness**: `GET /api/v1/scanner` exposes `overall.lastRunAt`/`overall.status`;
  the app flags runs older than 5 minutes as `stale`. Alert when `overall.stale`
  is non-null (worker down, provider failing, or scheduler stalled).
- **Backup liveness**: `docker compose --env-file infra/.env.prod -f
infra/compose.prod.yml exec backup cat /backups/status` shows the
  last dump (`OK <timestamp>` = green, `FAILED ...` = alert). Send that file's
  mtime/content to your monitor out of band.
- **Logs**: `docker compose --env-file infra/.env.prod -f infra/compose.prod.yml
logs -f --tail=200 web` / `worker`; worker cycles
  log a one-line summary (`[odds-collector] ok …`).

---

## 6. Backups & restore

```sh
# Every command below must name the production project explicitly. A bare
# `docker compose` resolves to the `dev` project (default project name = the
# directory name) and silently targets the wrong containers.
DC="docker compose --env-file infra/.env.prod -f infra/compose.prod.yml"

# on-demand backup
$DC exec -T backup /usr/local/bin/backup.sh

# list dumps + status (status readable for monitoring)
$DC exec backup sh -c 'cat /backups/status; ls -lh /backups'

# restore (DESTRUCTIVE — replaces target DB contents)
$DC exec -e RESTORE_YES=yes backup restore.sh /backups/void-20260924T020000Z.dump
```

#### Restoring needs two independent confirmations

`restore.sh` will not run on a single flag. It requires **both**:

1. `RESTORE_YES=yes` in the environment (pass it with `exec -e`, as above), and
2. typing the **target database name** at the prompt.

The typed confirmation is read from `/dev/tty` on purpose, so it cannot be
satisfied by a pipe, a here-doc or a CI `echo`. The practical consequence for
this runbook: **do not add `-T` to the restore command.** `-T` detaches the TTY,
the prompt cannot be read, and the restore refuses — which is the intended
behaviour, but it will look like a hang or a failure if you did not know.

The script is defensive beyond that, because a half-completed restore is an
outage: it refuses a pre-existing scratch database from an interrupted run,
verifies the restored copy is queryable and non-empty in a temporary database,
and only then swaps it in. The pre-restore database is kept by default, so a bad
restore is recoverable.

Backups live in `infra/backups/` on the host (a named volume would be an
alternative). Off-site/object storage sync of `infra/backups/` is an operator choice
(the bundle keeps it a thin, standard pg_dump format precisely so shipping is easy).

#### Data retention

A backup bounds how long you can lose data; retention bounds how much you
_accumulate_. Before Phase 19 nothing ever deleted a row: `raw_payloads` grows on
every poll (~3 kB per mock payload, measured ~530 MB/month at a 4/min poll rate),
and on the verify database it had reached 36 MB of a 47 MB database.

Retention is a **separate, explicit command**, not something the worker does on a
timer. `raw_payloads`, `scanner_health` and `odds_observations` are only written by
the scanner, so a scheduled prune competes with the workload for the same locks;
running it as its own job keeps the failure blast radius at zero.

```sh
# DRY RUN is the default — prints what would go, deletes nothing.
DATABASE_URL='postgresql://...' npm run db:retention

# enforce
DATABASE_URL='postgresql://...' npm run db:retention -- --apply

# override a window, or restrict to one table
RETENTION_RAW_PAYLOAD_DAYS=14 npm run db:retention -- --apply
```

| Variable                        | Default                | Effect                                |
| ------------------------------- | ---------------------- | ------------------------------------- |
| `RETENTION_RAW_PAYLOAD_DAYS`    | `7`                    | Raw provider wire payloads (spec §65) |
| `RETENTION_SCANNER_HEALTH_DAYS` | `30`                   | Scanner run history                   |
| `RETENTION_OBSERVATIONS_DAYS`   | `90`                   | Price history per selection           |
| `RETENTION_AUDIT_LOGS_DAYS`     | _unset = keep forever_ | Audit trail                           |
| `RETENTION_BATCH_SIZE`          | `1000`                 | Rows per DELETE statement             |
| `RETENTION_MAX_BATCHES`         | `20`                   | Statements per table per run          |

Three behaviours worth knowing before you schedule this:

- **`audit_logs` is never pruned by default.** Deleting the audit trail to save
  space is a compliance decision, so it stays opt-in. Set a positive number to
  enable it.
- **Work per run is bounded.** Each table is drained in `batchSize` chunks for at
  most `maxBatches` rounds. If a backlog outlasts that, the run prints
  `still pending` and exits 0 — rerun it, and it continues where it stopped.
  Cron hourly and it converges.
- **Space is reclaimed, not returned.** A bulk `DELETE` leaves dead tuples that
  autovacuum reclaims for reuse; the file on disk does not shrink without a
  blocking `VACUUM FULL`. Retention bounds _growth_, which is the goal — do not
  expect `pg_database_size` to drop the moment a prune finishes.

Schedule it from cron or a systemd timer on the host, not from inside the
container. The bundled compose stack has no scheduler for it (the only cron in
the deployment is the backup sidecar's own).

---

## 7. Deploy & rollback

```sh
# rebuild + restart with new images (zero-schema-change deploys)
docker compose --env-file infra/.env.prod -f infra/compose.prod.yml up -d --build web worker

# after a schema change: `up` already runs the one-shot migrate service first
# (web/worker wait on it), so this is only for running migrations alone —
# e.g. from a release job, before rolling the new images forward.
docker compose --env-file infra/.env.prod -f infra/compose.prod.yml run --rm migrate
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
- Builds happen in Vercel's cloud; `DB_EXPOSE_PORT`/`WEB_PORT` are irrelevant
  there. There is no `RUN_MIGRATIONS` flag in this bundle — the `migrate` service
  only exists on the Docker path, so on Vercel run migrations from the release
  step via `npx prisma migrate deploy`.

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

---

## 10. Credential leak runbook (rotate → purge → verify)

A committed secret has two halves and both must be closed. **Rotation is the half
that actually matters** — a force-push cannot recall objects that third parties,
PR refs or forge caches have already fetched.

Phase 18 reference incident: a ParlayAPI key was committed in Phase 3, published
to `origin`, then revoked and purged using exactly this procedure.

```sh
# 1) ROTATE FIRST, at the provider. Revoke the leaked key and issue a new one.
#    Nothing below substitutes for this.

# 2) Establish the exposure (do this before rewriting anything)
git log --all -S'<secret-fragment>' --oneline
npm run security:scan            # working tree (tracked + untracked, non-ignored)
npm run security:scan:history    # every commit, every ref

# 3) Recovery point + note your remote (filter-repo drops `origin`)
git tag pre-purge-backup
git remote -v

# 4) Build the redaction rules. Prefer a generic pattern over the literal value so
#    the rules file never becomes a second copy of the secret. One rule per line:
#      regex:<pattern>==>***REMOVED***
#      literal:<value>==>***REMOVED***
git filter-repo --replace-text purge-rules.txt --force

# 5) Restore the remote that filter-repo removed
git remote add origin git@github.com:<org>/<repo>.git
git remote -v

# 6) VERIFY BEFORE PUSHING — this must print PASS
npm run security:scan:history

# 7) Publish the rewritten history
git push origin --force --all
git push origin --force --tags
git push origin --delete pre-purge-backup

# 8) Clean up the rules file, then roll the new key into the environment
rm purge-rules.txt
```

Guidance:

- **Do not** use `git filter-repo --path <file> --invert-paths` on a file that
  merely _contains_ a secret. That deletes every revision of the file and all of
  its history. Use `--replace-text` to redact in place.
- **Commit before purging.** `filter-repo` resets the working tree, so uncommitted
  work is lost.
- Rewritten history changes every commit SHA from the first affected commit
  onward. Record the old→new map in `PROJECT_STATE.md` so the audit trail stays
  navigable, and delete the `pre-purge-backup` tag afterwards.
- Every collaborator must re-clone, or `git fetch && git reset --hard origin/main`.
  Stale local clones keep the old objects alive.
- A git purge does **not** touch host state, deployed images or CI secrets. If the
  leaked value ever reached a running host or CI, rotate those credentials in the
  hosting provider's secret manager too.
- Both scans are gated in the `security` CI job, so a fresh leak fails the
  pipeline before it can be pushed again.
