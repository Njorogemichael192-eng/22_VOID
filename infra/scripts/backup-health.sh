#!/bin/sh
set -eu

backup_dir=${BACKUP_DIR:-/backups}
status_file=${BACKUP_STATUS_FILE:-$backup_dir/status}
max_age=${BACKUP_MAX_AGE_SECONDS:-${BACKUP_HEALTH_MAX_AGE_SECONDS:-129600}}
# Probe the same target the backup actually writes, derived from DATABASE_URL.
# This previously read PGHOST/PGPORT/PGUSER/PGDATABASE, which compose hardcoded
# to the local `db` service, so the healthcheck could report green while the
# backup was pointed at an entirely different (or empty) database.
database_url=${DATABASE_URL:-}

case "$max_age" in
  ''|*[!0-9]*) exit 1 ;;
esac
[ "$max_age" -gt 0 ] || exit 1
[ -s "$status_file" ] || exit 1
[ -n "$database_url" ] || exit 1

IFS=' ' read -r result epoch remainder < "$status_file"
[ "$result" = OK ] || exit 1
case "$epoch" in
  ''|*[!0-9]*) exit 1 ;;
esac

now=$(date -u +%s)
age=$((now - epoch))
[ "$age" -ge -60 ] || exit 1
[ "$age" -le "$max_age" ] || exit 1
pg_isready -q -d "$database_url"
