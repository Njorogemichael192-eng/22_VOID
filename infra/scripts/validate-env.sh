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
    *[[:space:]]*|*'?'*|*'#'*|*/v4|*/v4/)
      fail "$base_url_name must be an origin without /v4, query, or fragment"
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
  case "$WORKER_PROVIDER" in
    mock|odds-api) ;;
    *) fail "WORKER_PROVIDER must be mock or odds-api" ;;
  esac

  if [ "$WORKER_PROVIDER" = odds-api ]; then
    validate_provider_key ODDS_API_KEY "${ODDS_API_KEY:-}"
  elif [ -n "${ODDS_API_KEY:-}" ]; then
    validate_provider_key ODDS_API_KEY "$ODDS_API_KEY"
  fi

  validate_base_url ODDS_API_BASE_URL "${ODDS_API_BASE_URL:-https://api.the-odds-api.com}"
  validate_positive_integer WORKER_HEALTH_PORT "${WORKER_HEALTH_PORT:-8081}"
  validate_positive_integer WORKER_STALENESS_MS "${WORKER_STALENESS_MS:-300000}"
  [ "${WORKER_HEALTH_PORT:-8081}" -le 65535 ] || fail "WORKER_HEALTH_PORT must be at most 65535"
fi
