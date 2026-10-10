#!/bin/sh
set -eu

fail() {
  printf 'environment validation failed: %s\n' "$1" >&2
  exit 1
}

is_placeholder() {
  placeholder_input=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')
  case "$placeholder_input" in
    ""|*"change-me"*|*"change_me"*|*"changeme"*|*"replace-me"*|*"replace_me"*|*"replace-with"*|*"replace_with"*|*"replaceme"*|*"placeholder"*|*"example.com"*|*"your-"*|*"unset"*)
      return 0
      ;;
  esac
  return 1
}

require_value() {
  required_name=$1
  required_value=${2:-}
  [ -n "$required_value" ] || fail "$required_name is required"
  if is_placeholder "$required_value"; then
    fail "$required_name contains a placeholder"
  fi
}

validate_key() {
  key_name=$1
  key_value=${2:-}
  require_value "$key_name" "$key_value"
  [ "${#key_value}" -ge 32 ] || fail "$key_name must be at least 32 characters"
  case "$key_value" in
    *[[:space:]]*) fail "$key_name must not contain whitespace" ;;
  esac
}

validate_provider_key() {
  provider_key_name=$1
  provider_key_value=${2:-}
  require_value "$provider_key_name" "$provider_key_value"
  [ "${#provider_key_value}" -ge 16 ] || fail "$provider_key_name must be at least 16 characters"
  case "$provider_key_value" in
    *[[:space:]]*) fail "$provider_key_name must not contain whitespace" ;;
  esac
}

# The Odds API issues fixed-length 32-character keys, so a length that is not 32
# is a truncated paste or the wrong credential entirely. Both surface as an
# opaque 401 at the provider, long after this script has passed. Other provider
# keys are only bounded below, because their issuers differ.
validate_odds_api_key() {
  validate_provider_key ODDS_API_KEY "${ODDS_API_KEY:-}"
  [ "${#ODDS_API_KEY}" -eq 32 ] || fail "ODDS_API_KEY must be exactly 32 characters (got ${#ODDS_API_KEY}) - The Odds API issues fixed-length keys, so any other length is a truncated paste or the wrong credential"
}

# ParlayAPI publishes no fixed key length, so this only guarantees the value is
# present and intact rather than inventing a floor the issuer does not honour.
# A truncated key still fails at the provider as a 401 with no quota reading,
# which the worker surfaces as that source DOWN.
validate_parlay_api_key() {
  parlay_key_value=${PARLAY_API_KEY:-}
  require_value PARLAY_API_KEY "$parlay_key_value"
  case "$parlay_key_value" in
    *[[:space:]]*) fail "PARLAY_API_KEY must not contain whitespace" ;;
  esac
}

validate_positive_integer() {
  integer_name=$1
  integer_value=${2:-}
  [ -n "$integer_value" ] || return 0
  case "$integer_value" in
    *[!0-9]*) fail "$integer_name must be a positive integer" ;;
  esac
  [ "$integer_value" -gt 0 ] || fail "$integer_name must be a positive integer"
}

validate_base_url() {
  base_url_name=$1
  base_url_value=${2:-}
  require_value "$base_url_name" "$base_url_value"
  case "$base_url_value" in
    https://*) ;;
    *) fail "$base_url_name must use https" ;;
  esac
  case "$base_url_value" in
    *[[:space:]]*|*'?'*|*'#'*|*/v[0-9]|*/v[0-9]/)
      fail "$base_url_name must be an origin without a version path, query, or fragment"
      ;;
  esac
  base_url_host=${base_url_value#https://}
  base_url_host=${base_url_host%%/*}
  [ -n "$base_url_host" ] || fail "$base_url_name must include a host"
  case "$base_url_host" in
    *[!A-Za-z0-9.:-]*) fail "$base_url_name has an invalid host" ;;
  esac
}

role=${SERVICE_ROLE:-${APP_ROLE:-}}
case "$role" in
  web|worker|migrate) ;;
  *) fail "SERVICE_ROLE must be web, worker, or migrate" ;;
esac

require_value DATABASE_URL "${DATABASE_URL:-}"
case "$DATABASE_URL" in
  postgres://*|postgresql://*) ;;
  *) fail "DATABASE_URL must use postgres:// or postgresql://" ;;
esac
case "$DATABASE_URL" in
  *://*@*/*) ;;
  *) fail "DATABASE_URL must include credentials, host, and database" ;;
esac
case "$DATABASE_URL" in
  *[[:space:]]*) fail "DATABASE_URL must not contain whitespace" ;;
esac

if [ -n "${API_KEY:-}" ]; then
  validate_key API_KEY "$API_KEY"
fi
if [ -n "${ADMIN_API_KEY:-}" ]; then
  validate_key ADMIN_API_KEY "$ADMIN_API_KEY"
fi
if [ -n "${API_KEY:-}" ] && [ -n "${ADMIN_API_KEY:-}" ] && [ "$API_KEY" = "$ADMIN_API_KEY" ]; then
  fail "API_KEY and ADMIN_API_KEY must be different"
fi

if [ "$role" = web ]; then
  validate_key API_KEY "${API_KEY:-}"
  validate_key ADMIN_API_KEY "${ADMIN_API_KEY:-}"
  [ "${DASHBOARD_SOURCE:-}" = db ] || fail "web requires DASHBOARD_SOURCE=db"
else
  if [ -n "${DASHBOARD_SOURCE:-}" ] && [ "$DASHBOARD_SOURCE" != db ]; then
    fail "DASHBOARD_SOURCE must be db"
  fi
fi

if [ "$role" = worker ]; then
  require_value WORKER_PROVIDER "${WORKER_PROVIDER:-}"

  # WORKER_PROVIDER is a comma-separated list: one cycle polls every provider
  # named here. Everything below mirrors what config.ts enforces, so the stack
  # fails once at the entrypoint with a readable message instead of Node
  # throwing inside a restart:unless-stopped loop.
  #
  # An empty segment is checked by shape rather than by iteration: `tr ',' '\n'`
  # and friends drop the empty field, so `odds-api,` would look like a valid
  # single-provider list while the worker refuses to start.
  case "$WORKER_PROVIDER" in
    ,*|*,|*,,*)
      fail "WORKER_PROVIDER must be a comma-separated list with no empty entries, e.g. odds-api or odds-api,parlay-api (got: $WORKER_PROVIDER)"
      ;;
  esac

  saved_ifs=$IFS
  IFS=' ,'
  # Word splitting is the split here; disable pathname expansion so a stray glob
  # character cannot expand into file names that then read as provider names.
  set -f
  # shellcheck disable=SC2086
  set -- $WORKER_PROVIDER
  set +f
  IFS=$saved_ifs

  provider_count=$#
  wants_mock=0
  wants_odds_api=0
  wants_parlay_api=0
  wants_example=0
  seen_providers=""

  for provider_name do
    case "$provider_name" in
      mock) wants_mock=1 ;;
      odds-api) wants_odds_api=1 ;;
      parlay-api) wants_parlay_api=1 ;;
      example) wants_example=1 ;;
      *) fail "WORKER_PROVIDER contains unknown provider '$provider_name' (expected: mock, odds-api, parlay-api, example)" ;;
    esac
    case " $seen_providers " in
      *" $provider_name "*)
        fail "WORKER_PROVIDER lists '$provider_name' twice - a repeat polls the same feed twice in one cycle and spends its quota twice"
        ;;
    esac
    seen_providers="$seen_providers $provider_name"
  done

  if [ "$wants_mock" -eq 1 ] && [ "$provider_count" -gt 1 ]; then
    fail "WORKER_PROVIDER=$WORKER_PROVIDER: mock cannot be combined with a real provider - its prices are fabricated, so mixing it with a live feed places invented odds beside real ones in a single detection pass and reports arbitrage that does not exist"
  fi

  # The reference adapter is development-only (config.ts refuses it in production
  # too): it serves fixture data from docs/ADDING_A_PROVIDER.md, so in a
  # production stack it would persist invented opportunities. This script is the
  # production entrypoint gate, so refusing it here is the same refusal.
  if [ "$wants_example" -eq 1 ]; then
    fail "WORKER_PROVIDER=$WORKER_PROVIDER: example is the credential-free reference adapter (docs/ADDING_A_PROVIDER.md) and serves fixture data, not a real feed - it is refused in a production stack. Fork it into a real adapter to add a provider"
  fi

  if [ "$wants_odds_api" -eq 1 ] || [ -n "${ODDS_API_KEY:-}" ]; then
    validate_odds_api_key
    validate_base_url ODDS_API_BASE_URL "${ODDS_API_BASE_URL:-https://api.the-odds-api.com}"
  fi
  if [ "$wants_parlay_api" -eq 1 ] || [ -n "${PARLAY_API_KEY:-}" ]; then
    validate_parlay_api_key
    validate_base_url PARLAY_API_BASE_URL "${PARLAY_API_BASE_URL:-https://parlay-api.com}"
  fi
  validate_positive_integer WORKER_HEALTH_PORT "${WORKER_HEALTH_PORT:-8081}"
  validate_positive_integer WORKER_STALENESS_MS "${WORKER_STALENESS_MS:-300000}"
  [ "${WORKER_HEALTH_PORT:-8081}" -le 65535 ] || fail "WORKER_HEALTH_PORT must be at most 65535"

  # The poll interval and the staleness ceiling are one setting, not two.
  # WORKER_STALENESS_MS is the age past which the last completed cycle counts as
  # stale: /healthz answers 503 and Docker marks the container unhealthy. The
  # scheduler idles SCANNER_POLL_INTERVAL_MS between cycles, so an interval above
  # that ceiling leaves the worker stale for the entire gap between every poll.
  # restart: unless-stopped restarts on exit, not on health, so it never self-
  # corrects. Checked here as well as in config.ts so the stack fails once at the
  # entrypoint with a readable message, instead of Node throwing inside a
  # restart:unless-stopped loop.
  validate_positive_integer SCANNER_POLL_INTERVAL_MS "${SCANNER_POLL_INTERVAL_MS:-15000}"
  poll_interval_ms=${SCANNER_POLL_INTERVAL_MS:-15000}
  staleness_ms=${WORKER_STALENESS_MS:-300000}
  if [ "$poll_interval_ms" -gt "$staleness_ms" ]; then
    fail "SCANNER_POLL_INTERVAL_MS=$poll_interval_ms exceeds WORKER_STALENESS_MS=$staleness_ms - the worker would report itself stale (unhealthy) for the whole gap between every poll. Raise WORKER_STALENESS_MS above SCANNER_POLL_INTERVAL_MS or lower the poll interval."
  fi

  # Health alerting (Phase 19) is opt-in on ALERT_WEBHOOK_URL. An alert names which
  # feeds are down, so a plain-http webhook is refused here exactly as the worker
  # refuses it at startup. Only the scheme is checked: the URL legitimately carries
  # its secret in the path or query (a Slack-style incoming hook).
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    case "$ALERT_WEBHOOK_URL" in
      https://*) ;;
      *) fail "ALERT_WEBHOOK_URL must be an https:// URL (got: $ALERT_WEBHOOK_URL)" ;;
    esac
  fi
  case "${ALERT_MIN_SEVERITY:-warning}" in
    info|warning|critical) ;;
    *) fail "ALERT_MIN_SEVERITY must be one of info, warning, critical (got: ${ALERT_MIN_SEVERITY:-})" ;;
  esac
  # A zero re-notify is meaningful (fire once, then only resolve), so it is not a
  # positive integer like the rest.
  case "${ALERT_RENOTIFY_MS:-1800000}" in
    ''|*[!0-9]*) fail "ALERT_RENOTIFY_MS must be a non-negative integer (got: ${ALERT_RENOTIFY_MS:-})" ;;
  esac
  validate_positive_integer ALERT_HYSTERESIS "${ALERT_HYSTERESIS:-1}"
  validate_positive_integer ALERT_CHECK_INTERVAL_MS "${ALERT_CHECK_INTERVAL_MS:-30000}"
fi
