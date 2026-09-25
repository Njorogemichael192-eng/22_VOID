#!/bin/sh
set -eu

backup_dir=${BACKUP_DIR:-/backups}
status_file=${BACKUP_STATUS_FILE:-$backup_dir/status}
max_age=${BACKUP_MAX_AGE_SECONDS:-${BACKUP_HEALTH_MAX_AGE_SECONDS:-129600}}
pg_host=${PGHOST:-db}
pg_port=${PGPORT:-5432}
pg_user=${PGUSER:-}
pg_database=${PGDATABASE:-}

case "$max_age" in
  ''|*[!0-9]*) exit 1 ;;
esac
[ "$max_age" -gt 0 ] || exit 1
[ -s "$status_file" ] || exit 1

IFS=' ' read -r result epoch remainder < "$status_file"
[ "$result" = OK ] || exit 1
case "$epoch" in
  ''|*[!0-9]*) exit 1 ;;
esac

now=$(date -u +%s)
age=$((now - epoch))
[ "$age" -ge -60 ] || exit 1
[ "$age" -le "$max_age" ] || exit 1
[ -n "$pg_user" ] || exit 1
[ -n "$pg_database" ] || exit 1
pg_isready -q -h "$pg_host" -p "$pg_port" -U "$pg_user" -d "$pg_database"
