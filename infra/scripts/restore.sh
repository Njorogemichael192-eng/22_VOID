#!/bin/sh
# infra/scripts/restore.sh
#
# Restores a dump over the live database.
#
# Safety model, in order of how much data each step can destroy:
#
#   1. Nothing is dropped up front. The old version of this script called
#      `dropdb --force` on the live database and *then* ran pg_restore, so any
#      failure — a corrupt dump, a full disk, a lost connection, a
#      mid-restore constraint error — left production with no database at all.
#      A restore you can fail halfway is not a restore, it is an outage.
#   2. The dump goes into a scratch database that is verified while the live
#      database keeps serving traffic untouched.
#   3. Only a verified scratch database is swapped in, via RENAME, which is
#      metadata-only and takes milliseconds.
#   4. The pre-restore database is *kept* by default, so a bad restore is
#      recoverable with a second rename instead of being a dead end.
#
# Two independent confirmations are required, because an accidentally-successful
# restore of the wrong dump is indistinguishable from a good one at 3am:
#   RESTORE_YES=yes            in the environment, and
#   typing the target database name at the prompt (read from /dev/tty, so it
#   cannot be satisfied by a pipe or a here-doc).
#
# Usage:
#   RESTORE_YES=yes restore.sh <dump-file>
#
set -eu

umask 077

# shellcheck source=infra/scripts/database-url.sh
. "$(dirname "$0")/database-url.sh"

backup_dir=${BACKUP_DIR:-/backups}
dump=${1:-}
restore_yes=${RESTORE_YES:-}
temp_db=${RESTORE_TEMP_DB:-restore_temp}
expected_host=${RESTORE_EXPECTED_HOST:-${BACKUP_EXPECTED_HOST:-db}}
drop_old=${RESTORE_DROP_OLD:-false}
check_prisma=${RESTORE_CHECK_PRISMA:-true}

fail() {
  printf '[restore] ERROR: %s\n' "$1" >&2
  exit 1
}

note() {
  printf '[restore] %s\n' "$1"
}

# If a scratch database is left behind by an interrupted run, every retry would
# fail on `createdb: already exists` and, worse, a stale scratch database could
# be mistaken for a fresh verified one. Refuse loudly instead of reusing it.
refuse_stale_temp() {
  if psql "$maintenance_uri" -Atqc "SELECT 1 FROM pg_database WHERE datname = '$temp_db'" 2>/dev/null | grep -q 1; then
    fail "scratch database '$temp_db' already exists; a previous restore may have been interrupted. Inspect and drop it deliberately: dropdb --force '$temp_db'"
  fi
}

verify_restored_db() {
  _v_uri=$1
  _v_label=$2

  psql "$_v_uri" -Atqc 'SELECT 1' >/dev/null 2>&1 ||
    fail "$_v_label database is not queryable after restore; live database left untouched"

  _v_tables=$(psql "$_v_uri" -Atqc "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'" 2>/dev/null) ||
    fail "$_v_label database schema could not be inspected; live database left untouched"
  case "$_v_tables" in
    '' | *[!0-9]*)
      fail "$_v_label database table count is not a number ('$_v_tables'); live database left untouched"
      ;;
  esac
  [ "$_v_tables" -gt 0 ] ||
    fail "$_v_label database contains no tables in schema public; refusing to swap in an empty database"

  if [ "$check_prisma" = true ]; then
    psql "$_v_uri" -Atqc "SELECT to_regclass('public._prisma_migrations')" 2>/dev/null | grep -q _prisma_migrations ||
      fail "$_v_label database has no _prisma_migrations table, so migration state did not come back with the data; set RESTORE_CHECK_PRISMA=false to override"
  fi

  note "$_v_label database verified: $_v_tables table(s) in schema public"
}

if [ -z "$dump" ]; then
  printf '%s\n' "usage: RESTORE_YES=yes restore.sh <dump-file>" >&2
  printf '%s\n' "latest dump: $(find "$backup_dir" -type f -name 'void-*.dump' -print 2>/dev/null | sort | tail -n 1)" >&2
  exit 2
fi

# ---------------------------------------------------------------- confirmations
# Checked before anything touches the server, and before the dump is even read,
# so that a mistyped command cannot get as far as the maintenance database.
if [ -z "$restore_yes" ]; then
  fail 'restore replaces the live database; set RESTORE_YES=yes to continue'
fi
case "$restore_yes" in
  yes | YES) ;;
  *) fail "RESTORE_YES must be exactly 'yes' (got '$restore_yes')" ;;
esac

# ------------------------------------------------------------------- target
database_url=${DATABASE_URL:-}
database_url_parse "$database_url" "$expected_host" ||
  fail "$DATABASE_URL_ERROR; set RESTORE_EXPECTED_HOST to acknowledge this target, or the restore would target the wrong database"

target_db=$DATABASE_URL_DATABASE
database_url_check_identifier "$target_db" ||
  fail "target database name '$target_db' is not a usable identifier"
database_url_check_identifier "$temp_db" ||
  fail "RESTORE_TEMP_DB ('$temp_db') is not a usable identifier"
[ "$temp_db" != "$target_db" ] ||
  fail "RESTORE_TEMP_DB must differ from the target database ('$target_db')"

maintenance_uri=$(database_url_for_db "$database_url" postgres)
temp_uri=$(database_url_for_db "$database_url" "$temp_db")

# ------------------------------------------------------------------- artifact
[ -f "$dump" ] || fail "dump not found: $dump"

checksum="$dump.sha256"
if [ -f "$checksum" ]; then
  dump_dir=$(dirname "$dump")
  dump_name=$(basename "$dump")
  checksum_name=$(basename "$checksum")
  (cd "$dump_dir" && sha256sum -c "$checksum_name" >/dev/null) || fail 'SHA-256 verification failed'
  note "SHA-256 verified: $dump_name"
elif [ "${ALLOW_UNVERIFIED_RESTORE:-false}" != true ]; then
  fail "checksum not found: $checksum (set ALLOW_UNVERIFIED_RESTORE=true only for a known dump)"
else
  note "WARNING: proceeding without a checksum for $dump"
fi

pg_restore --list "$dump" >/dev/null || fail 'pg_restore --list verification failed'
note 'dump archive structure verified'

# ------------------------------------------------------------- typed confirmation
# Read from the terminal, not stdin: stdin is routinely redirected (a heredoc, a
# pipe, `docker compose exec -T`) and a confirmation that can be satisfied by
# redirected input is not a confirmation.
#
# `[ -r /dev/tty ]` is not a sufficient probe: where there is no controlling
# terminal the device can be present and appear readable while every access fails
# with ENXIO. Probe by actually writing, so the failure surfaces as this message
# rather than a bare shell error from the middle of the prompt.
#
# Two deliberate details, both found the hard way:
#   `2>/dev/null` is ordered BEFORE the tested redirect, because redirections are
#   applied left to right and the shell reports a failed open on whatever stderr
#   is already in place.
#   the probe is `true`, not `:`. A redirection error on a POSIX *special*
#   built-in is fatal, so `: > /dev/tty` terminated the script with status 1 and
#   no message at all. `true` is a regular built-in, so the error is recoverable
#   and the operator gets the actionable message below.
if [ ! -r /dev/tty ] || ! true 2>/dev/null > /dev/tty; then
  fail 'no terminal available for the confirmation prompt; run this interactively without -T so you can type the database name'
fi

printf '\n' > /dev/tty || fail 'lost access to the terminal before confirmation; nothing was changed'
printf 'About to restore:\n' > /dev/tty
printf '  dump           %s\n' "$dump" > /dev/tty
printf '  host           %s\n' "$DATABASE_URL_HOST" > /dev/tty
printf '  live database  %s  (this is replaced)\n' "$target_db" > /dev/tty
printf '  scratch db     %s  (restored and verified first)\n' "$temp_db" > /dev/tty
printf '\n' > /dev/tty
printf 'Type the live database name (%s) to continue: ' "$target_db" > /dev/tty

typed=
if ! IFS= read -r typed < /dev/tty; then
  printf '\n' > /dev/tty 2>&1 || true
  fail 'could not read confirmation; nothing was changed'
fi
printf '\n' > /dev/tty 2>&1 || true

[ -n "$typed" ] || fail 'confirmation was empty; nothing was changed'
# Constant-time-ish compare is pointless here; the value is not a secret. What
# matters is that it is an exact match, so a trailing space or a copy/paste of
# the whole prompt cannot slip through.
[ "$typed" = "$target_db" ] ||
  fail "confirmation '$typed' did not match the live database name '$target_db'; nothing was changed"

# ------------------------------------------------------------------- guard rails
refuse_stale_temp

if [ "$drop_old" != true ]; then
  note 'the pre-restore database is KEPT after the swap (set RESTORE_DROP_OLD=true to drop it)'
fi

# ------------------------------------------------------------- 1. restore to scratch
note "creating scratch database $temp_db"
createdb "$temp_db" --maintenance-db="$maintenance_uri" ||
  fail "could not create scratch database $temp_db; live database left untouched"

# Only an unverified scratch database is worth throwing away. Once it has been
# verified, every later failure should leave it in place: if the swap itself goes
# wrong it is the only restored copy on the server.
scratch_verified=false
cleanup_scratch() {
  if [ "$scratch_verified" = true ]; then
    note "verified scratch database $temp_db left in place for inspection"
  elif [ "${RESTORE_KEEP_FAILED_SCRATCH:-false}" = true ]; then
    note "failed scratch database $temp_db left in place for inspection (RESTORE_KEEP_FAILED_SCRATCH=true)"
  else
    dropdb --if-exists --force "$temp_db" --maintenance-db="$maintenance_uri" >/dev/null 2>&1 || true
  fi
}
trap 'cleanup_scratch' EXIT

note "restoring into $temp_db (this can take a while)"
pg_restore --no-owner --no-privileges --exit-on-error -d "$temp_uri" "$dump" ||
  fail "pg_restore failed; the live database $target_db was never touched"

# ------------------------------------------------------------- 2. verify scratch
verify_restored_db "$temp_uri" "scratch"
scratch_verified=true

# ------------------------------------------------------------- 3. swap
# RENAME is metadata-only, so the window in which the live name is absent is a
# couple of catalog updates rather than a data copy.
swap_stamp=$(date -u +%Y%m%d%H%M%S)
old_db="${target_db}_pre_restore_${swap_stamp}"
database_url_check_identifier "$old_db" ||
  fail "generated rollback database name '$old_db' is not a usable identifier"

live_exists=$(psql "$maintenance_uri" -Atqc "SELECT 1 FROM pg_database WHERE datname = '$target_db'" 2>/dev/null | grep -c 1 || true)
case "$live_exists" in
  0 | 1) ;;
  *) fail "could not determine whether database '$target_db' exists; live database left untouched" ;;
esac

if [ "$live_exists" = 1 ]; then
  note "moving live database $target_db aside to $old_db"
  psql "$maintenance_uri" -Atqc "ALTER DATABASE \"$target_db\" RENAME TO \"$old_db\"" >/dev/null 2>&1 ||
    fail "could not rename $target_db aside; live database left untouched"
else
  note "no existing database named $target_db; nothing to move aside"
fi

if ! psql "$maintenance_uri" -Atqc "ALTER DATABASE \"$temp_db\" RENAME TO \"$target_db\"" >/dev/null 2>&1; then
  # Put the original name back before giving up, so a swap failure does not
  # leave the operator with a database under an unfamiliar name.
  if [ "$live_exists" = 1 ]; then
    psql "$maintenance_uri" -Atqc "ALTER DATABASE \"$old_db\" RENAME TO \"$target_db\"" >/dev/null 2>&1 ||
      note "CRITICAL: could not rename $old_db back to $target_db; the original data is in $old_db"
  fi
  fail "could not promote $temp_db to $target_db; the original database was not destroyed"
fi

# ------------------------------------------------------------- 4. verify live, then clean up
# Verify against DATABASE_URL, i.e. the database now named $target_db. Pointing
# this at the maintenance URI would have re-checked the wrong database and
# reported success regardless of the swap.
verify_restored_db "$database_url" "live"

if [ "$live_exists" = 1 ]; then
  if [ "$drop_old" = true ]; then
    note "dropping pre-restore database $old_db"
    dropdb --if-exists --force "$old_db" --maintenance-db="$maintenance_uri" >/dev/null 2>&1 ||
      note "WARNING: could not drop $old_db; drop it manually when convenient"
  else
    note "pre-restore data preserved in $old_db"
    note "to roll back: psql '$maintenance_uri' -c 'ALTER DATABASE \"$old_db\" RENAME TO \"$target_db\"'"
  fi
fi

trap - EXIT
printf '[restore] OK: %s -> %s\n' "$dump" "$target_db"
