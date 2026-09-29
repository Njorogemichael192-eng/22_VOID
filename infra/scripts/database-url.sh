# shellcheck shell=sh
# infra/scripts/database-url.sh — sourced, never executed.
#
# Single source of truth for "which database does this deployment actually use?".
# The app (web/worker/migrate) connects through DATABASE_URL. The backup and
# restore sidecars used to carry their own PGHOST=db / PGDATABASE settings, which
# meant an external DATABASE_URL was silently ignored: backups dumped the empty
# local `db` service and a restore dropped the wrong database.
#
# Both scripts source this file and get the same parsing, the same host
# allow-list policy, and the same fail-fast behaviour. Two hand-rolled parsers
# would eventually disagree, and a disagreement here is silent data loss.
#
# Exported by database_url_parse:
#   DATABASE_URL_HOST     host component, IPv6 brackets stripped
#   DATABASE_URL_DATABASE database name component
#   DATABASE_URL_ERROR    human-readable reason for a rejection
#
# Sourced under `set -eu`; every expansion is guarded so an unset caller variable
# cannot abort the sourcing script.

# database_url_parse <url> <expected-host-list>
#
# <expected-host-list> is comma-separated. An empty list falls back to `db`, the
# compose service name, so the bundled single-host deployment works untouched
# while any external database must be acknowledged explicitly.
database_url_parse() {
  DATABASE_URL_ERROR=''

  _du_url=$1
  _du_expected=${2:-}
  [ -n "$_du_expected" ] || _du_expected=db

  if [ -z "$_du_url" ]; then
    DATABASE_URL_ERROR='DATABASE_URL is not set; refusing to guess which database to use'
    return 1
  fi

  case "$_du_url" in
    postgres://*|postgresql://*) ;;
    *)
      DATABASE_URL_ERROR='DATABASE_URL must start with postgres:// or postgresql://'
      return 1
      ;;
  esac

  # scheme://authority/path?params
  _du_target=${_du_url#*://}
  _du_params=''
  case "$_du_target" in
    *\?*)
      _du_params="?${_du_target#*\?}"
      _du_target=${_du_target%%\?*}
      ;;
  esac

  if [ "${_du_target#*/}" = "$_du_target" ]; then
    _du_authority=$_du_target
    _du_path=''
  else
    _du_authority=${_du_target%%/*}
    _du_path=${_du_target#*/}
  fi

  case "$_du_authority" in
    *@*) _du_hostport=${_du_authority##*@} ;;
    *) _du_hostport=$_du_authority ;;
  esac

  case "$_du_hostport" in
    \[*)
      # Bracketed IPv6 literal: the host runs from '[' to the first ']'.
      _du_host=$(printf '%s' "$_du_hostport" | sed -e 's/^\[\([^]]*\).*$/\1/')
      ;;
    *:*) _du_host=${_du_hostport%%:*} ;;
    *) _du_host=$_du_hostport ;;
  esac

  if [ -z "$_du_host" ]; then
    DATABASE_URL_ERROR='DATABASE_URL does not contain a host'
    return 1
  fi

  if [ -z "$_du_path" ]; then
    DATABASE_URL_ERROR='DATABASE_URL does not contain a database name'
    return 1
  fi

  case "$_du_path" in
    */*)
      DATABASE_URL_ERROR='DATABASE_URL database name must not contain a slash'
      return 1
      ;;
    *[[:space:]]*)
      DATABASE_URL_ERROR='DATABASE_URL database name must not contain whitespace'
      return 1
      ;;
  esac

  _du_allowed=false
  for _du_candidate in $(printf '%s' "$_du_expected" | tr ',' ' '); do
    _du_candidate=$(printf '%s' "$_du_candidate" | tr -d '[:space:]')
    if [ -n "$_du_candidate" ] && [ "$_du_candidate" = "$_du_host" ]; then
      _du_allowed=true
    fi
  done
  if ! $_du_allowed; then
    DATABASE_URL_ERROR="DATABASE_URL host '$_du_host' is not in the allowed host list ('$_du_expected')"
    return 1
  fi

  DATABASE_URL_HOST=$_du_host
  DATABASE_URL_DATABASE=$_du_path
  return 0
}

# database_url_for_db <url> <database-name>
#
# Prints <url> with its database component replaced, preserving any query
# parameters (sslmode, sslrootcert, …). Callers use this to address the
# maintenance database or a scratch database on the same server, which is why
# the parameters must survive: dropping them would silently downgrade a
# TLS-required connection.
database_url_for_db() {
  _duf_url=$1
  _duf_db=$2
  _duf_base=${_duf_url%%\?*}
  _duf_params=''
  case "$_duf_url" in
    *\?*) _duf_params="?${_duf_url#*\?}" ;;
  esac
  printf '%s/%s%s' "${_duf_base%/*}" "$_duf_db" "$_duf_params"
}

# Postgres truncates identifiers at 63 bytes; anything longer would silently
# collide with an existing name, so refuse rather than truncate.
database_url_check_identifier() {
  case "$1" in
    '') return 1 ;;
    *[!A-Za-z0-9_-]*) return 1 ;;
  esac
  [ "${#1}" -le 63 ] || return 1
  return 0
}
