#!/bin/sh
set -eu

backup_dir=${BACKUP_DIR:-/backups}
dump=${1:-}
confirm=${CONFIRM_RESTORE:-}

fail() {
  printf '[restore] ERROR: %s\n' "$1" >&2
  exit 1
}

if [ -z "$dump" ]; then
  printf '%s\n' "usage: CONFIRM_RESTORE=YES restore.sh <dump-file>" >&2
  printf '%s\n' "latest dump: $(find "$backup_dir" -type f -name 'void-*.dump' -print 2>/dev/null | sort | tail -n 1)" >&2
  exit 2
fi
[ "$confirm" = YES ] || fail 'restore is destructive; set CONFIRM_RESTORE=YES to continue'
[ -f "$dump" ] || fail "dump not found: $dump"

checksum="$dump.sha256"
if [ -f "$checksum" ]; then
  dump_dir=$(dirname "$dump")
  dump_name=$(basename "$dump")
  checksum_name=$(basename "$checksum")
  (cd "$dump_dir" && sha256sum -c "$checksum_name" >/dev/null) || fail 'SHA-256 verification failed'
elif [ "${ALLOW_UNVERIFIED_RESTORE:-false}" != true ]; then
  fail "checksum not found: $checksum (set ALLOW_UNVERIFIED_RESTORE=true only for a known dump)"
fi

pg_restore --list "$dump" >/dev/null || fail 'pg_restore --list verification failed'

database=${PGDATABASE:?PGDATABASE is required}
case "$database" in
  ''|*[!A-Za-z0-9_-]*) fail 'PGDATABASE contains unsupported characters' ;;
esac

dropdb --maintenance-db=postgres --if-exists --force "$database" || fail 'could not drop target database'
createdb --maintenance-db=postgres "$database" || fail 'could not create target database'
pg_restore --no-owner --no-privileges --exit-on-error -d "$database" "$dump" || fail 'pg_restore failed'

printf '[restore] OK: %s -> %s\n' "$dump" "$database"
