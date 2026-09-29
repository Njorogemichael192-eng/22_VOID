#!/bin/sh
set -eu

umask 077

# Shared DATABASE_URL parsing; see database-url.sh for why this is not inline.
# shellcheck source=infra/scripts/database-url.sh
. "$(dirname "$0")/database-url.sh"

backup_dir=${BACKUP_DIR:-/backups}
retention_days=${BACKUP_RETENTION_DAYS:-14}
status_file=${BACKUP_STATUS_FILE:-$backup_dir/status}
lock_dir=${BACKUP_LOCK_DIR:-$backup_dir/.backup.lock}
lock_owner_file=$lock_dir/owner
# Age past which a lock whose owner cannot be verified is treated as debris.
# 24h: comfortably longer than any plausible pg_dump+upload, short enough that a
# wedged backup self-heals within a day.
lock_stale_seconds=${BACKUP_LOCK_STALE_SECONDS:-86400}
# A lock younger than this with no metadata yet is assumed to belong to a peer
# that is mid-acquisition, not to debris.
lock_grace_seconds=${BACKUP_LOCK_METADATA_GRACE_SECONDS:-30}
s3_enabled=${S3_ENABLED:-false}
# BACKUP_REQUIRE_OFFSITE is the canonical name. The two earlier spellings are
# still honoured, because renaming a variable that gates data safety without an
# alias would silently drop enforcement on deployments already using them.
if [ -n "${BACKUP_REQUIRE_OFFSITE:-}" ]; then
  offsite_required=$BACKUP_REQUIRE_OFFSITE
  offsite_legacy_name=
elif [ -n "${BACKUP_REQUIRE_OFFHOST:-}" ]; then
  offsite_required=$BACKUP_REQUIRE_OFFHOST
  offsite_legacy_name=BACKUP_REQUIRE_OFFHOST
elif [ -n "${BACKUP_OFFHOST_REQUIRED:-}" ]; then
  offsite_required=$BACKUP_OFFHOST_REQUIRED
  offsite_legacy_name=BACKUP_OFFHOST_REQUIRED
else
  offsite_required=false
  offsite_legacy_name=
fi
s3_endpoint=${S3_ENDPOINT:-}
s3_region=${S3_REGION:-us-east-1}
s3_bucket=${S3_BUCKET:-}
s3_prefix=${S3_PREFIX:-}
s3_access_key=${S3_ACCESS_KEY_ID:-}
s3_secret_key=${S3_SECRET_ACCESS_KEY:-}
s3_sse=${S3_SSE:-AES256}
s3_sse_kms_key_id=${S3_SSE_KMS_KEY_ID:-}

write_status() {
  status_tmp="$status_file.tmp.$$"
  printf '%s\n' "$1" > "$status_tmp"
  mv -f "$status_tmp" "$status_file"
}

fail() {
  failure_stamp=$(date -u +%Y%m%dT%H%M%SZ)
  write_status "FAILED $failure_stamp $1" || true
  printf '[backup] ERROR: %s\n' "$1" >&2
  exit 1
}

cleanup() {
  lock_remove
}

# --- locking -----------------------------------------------------------------
#
# `mkdir` is the right primitive: it is atomic, so two concurrent runs cannot
# both win. The problem is what happens when a run dies without cleaning up: a
# SIGKILL (or an OOM kill) leaves the lock directory on the backups volume, and
# because that volume outlives the container, every future run sees a lock that
# nobody will ever release. The backup is wedged forever and the only fix is an
# SSH session and a manual rmdir.
#
# So the lock records who owns it, and a failed acquisition decides whether the
# incumbent is alive or is debris:
#
#   * no usable metadata and younger than the grace period -> a peer is
#     mid-acquisition; back off
#   * PID dead -> debris
#   * PID alive but /proc says it is not a backup process -> PID reuse; debris
#   * PID alive and genuinely a backup process -> a real peer; back off
#   * PID alive, unverifiable, and older than the threshold -> debris
#
# The age threshold alone would not be enough, and neither would the PID alone.
# The container case is the one that bites: restart the backup container and its
# PIDs are renumbered from the bottom, so the dead run's recorded PID is very
# often alive again and belongs to something unrelated. A PID-only check
# re-wedges the lock it was meant to clear, which is why /proc is consulted.

lock_remove() {
  # rmdir alone would fail once the owner file exists, leaving the lock behind
  # and wedging the next run. Remove the metadata first, then the directory.
  rm -f "$lock_owner_file" 2>/dev/null || true
  rmdir "$lock_dir" 2>/dev/null || true
}

lock_now() {
  date -u +%s
}

# mtime of a path, GNU/busybox stat first, then BSD. Empty if undeterminable.
lock_mtime() {
  stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || printf ''
}

lock_pid_alive() {
  kill -0 "$1" 2>/dev/null
}

# True when the PID is demonstrably still running backup.sh. Returns 0 when it
# cannot disprove ownership, because /proc may be unavailable; callers combine
# this with the age threshold rather than trusting it alone.
lock_pid_is_backup() {
  _lpb=$1
  [ -r "/proc/$_lpb/cmdline" ] || return 0
  tr '\0' ' ' < "/proc/$_lpb/cmdline" 2>/dev/null | grep -q 'backup\.sh'
}

lock_write_owner() {
  printf '%s\n%s\n' "$$" "$(lock_now)" > "$lock_owner_file" 2>/dev/null || true
}

# Returns 0 if this process now owns the lock, 1 if a live peer holds it.
lock_acquire() {
  if mkdir "$lock_dir" 2>/dev/null; then
    lock_write_owner
    return 0
  fi

  _l_pid=
  _l_started=
  if [ -f "$lock_owner_file" ]; then
    _l_pid=$(sed -n 1p "$lock_owner_file" 2>/dev/null || printf '')
    _l_started=$(sed -n 2p "$lock_owner_file" 2>/dev/null || printf '')
  fi
  case "$_l_pid" in '' | *[!0-9]*) _l_pid='' ;; esac
  case "$_l_started" in '' | *[!0-9]*) _l_started='' ;; esac

  _l_now=$(lock_now)
  if [ -n "$_l_pid" ] && [ -n "$_l_started" ]; then
    _l_have_meta=true
    _l_age=$((_l_now - _l_started))
  else
    _l_have_meta=false
    _l_mtime=$(lock_mtime "$lock_dir")
    case "$_l_mtime" in '' | *[!0-9]*) _l_mtime='' ;; esac
    if [ -n "$_l_mtime" ]; then
      _l_age=$((_l_now - _l_mtime))
    else
      _l_age=''
    fi
  fi

  # The grace period only means anything when there is no owner metadata to
  # reason with. Applying it to a lock that *does* record a PID would refuse to
  # start for 30s after any crash, and would report "owner not written yet" for
  # a lock that plainly has one written.
  if [ "$_l_have_meta" != true ] && [ -n "$_l_age" ] && [ "$_l_age" -lt "$lock_grace_seconds" ]; then
    printf '[backup] another backup run is active (lock is %ss old, owner not written yet)\n' "$_l_age"
    return 1
  fi

  if [ -n "$_l_pid" ] && lock_pid_alive "$_l_pid"; then
    if lock_pid_is_backup "$_l_pid"; then
      # A verified live backup. Do not steal its lock even when it is older than
      # the threshold: a legitimately long-running pg_dump would then race a
      # second dump, a second upload and a second retention prune against it.
      if [ -n "$_l_age" ] && [ "$_l_age" -gt "$lock_stale_seconds" ]; then
        printf '[backup] WARNING: lock held by live backup pid %s for %ss, beyond BACKUP_LOCK_STALE_SECONDS=%s; leaving it in place\n' \
          "$_l_pid" "$_l_age" "$lock_stale_seconds" >&2
      fi
      printf '[backup] another backup run is active (pid %s)\n' "$_l_pid"
      return 1
    fi
    if [ -n /proc ] && [ -r "/proc/$_l_pid/cmdline" ]; then
      _l_reason="pid $_l_pid is alive but is not a backup process (PID reused after a restart)"
    elif [ -n "$_l_age" ] && [ "$_l_age" -gt "$lock_stale_seconds" ]; then
      _l_reason="pid $_l_pid is alive but unverifiable and the lock is ${_l_age}s old, beyond BACKUP_LOCK_STALE_SECONDS=$lock_stale_seconds"
    else
      printf '[backup] another backup run is active (pid %s)\n' "$_l_pid"
      return 1
    fi
  elif [ -n "$_l_pid" ]; then
    _l_reason="pid $_l_pid is no longer running"
  elif [ -n "$_l_age" ]; then
    _l_reason="lock has no owner metadata and is ${_l_age}s old"
  else
    _l_reason="lock has no owner metadata and no readable timestamp"
  fi

  printf '[backup] removing stale lock: %s\n' "$_l_reason"
  lock_remove
  if mkdir "$lock_dir" 2>/dev/null; then
    lock_write_owner
    return 0
  fi

  printf '[backup] another backup run is active (lock was reclaimed by a peer)\n'
  return 1
}

is_placeholder() {
  placeholder_input=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')
  case "$placeholder_input" in
    *change-me*|*change_me*|*changeme*|*replace-me*|*replace_me*|*replace-with*|*replace_with*|*replaceme*|*placeholder*|*example.com*|*your-*|*unset*)
      return 0
      ;;
  esac
  return 1
}

# --- offsite (S3) validation --------------------------------------------------
#
# Runs before the lock is taken and before pg_dump, so a deployment that cannot
# possibly produce an offsite copy says so in milliseconds instead of writing a
# full local dump every night and only then reporting failure. "Fail immediately"
# is the whole point: a same-host-only backup that is discovered to be
# same-host-only only after a host loss is not a backup.
#
# Sets s3_active=true when an offsite destination is configured and usable.

validate_offsite_config() {
  s3_active=false

  if [ -n "$offsite_legacy_name" ]; then
    printf '[backup] WARNING: %s is deprecated; use BACKUP_REQUIRE_OFFSITE\n' "$offsite_legacy_name" >&2
  fi

  # is_true returns 1 for a valid "false" and 2 for garbage, so its status has to
  # be captured without tripping `set -e`. `$(is_true "$x"; printf ...)` aborted
  # the subshell on a legitimate "false", killing the script with an empty status
  # file and no diagnostic; `$(is_true "$x" || printf ...)` lost the status on a
  # legitimate "true". Assigning through `||` is correct for all three outcomes.
  _vo_state=0
  is_true "$offsite_required" || _vo_state=$?
  [ "$_vo_state" -ne 2 ] || fail 'BACKUP_REQUIRE_OFFSITE must be true or false'

  _ve_state=0
  is_true "$s3_enabled" || _ve_state=$?
  [ "$_ve_state" -ne 2 ] || fail 'S3_ENABLED must be true or false'

  # Assigned via `if` rather than `is_true ... && x=true`: the exit status of a
  # failing AND-list is easy to misjudge under `set -eu`, and `if` is exempt by
  # construction. is_true returning 1 for a legitimate "false" must not be able
  # to abort the run.
  _vo_required=false
  if is_true "$offsite_required"; then _vo_required=true; fi
  _ve_wanted=false
  if is_true "$s3_enabled"; then _ve_wanted=true; fi

  if [ "$_vo_required" = true ] && [ "$_ve_wanted" != true ]; then
    fail 'offsite backup is required (BACKUP_REQUIRE_OFFSITE=true) but S3_ENABLED is not true, so every copy would stay on this host. Set S3_ENABLED=true with S3_BUCKET and credentials, or set BACKUP_REQUIRE_OFFSITE=false to explicitly accept same-host-only backups'
  fi

  if [ "$_ve_wanted" != true ] && [ -z "$s3_bucket" ]; then
    [ "$_vo_required" = true ] || return 0
    fail 'offsite backup is required but neither S3_ENABLED nor S3_BUCKET is set'
  fi

  [ -n "$s3_bucket" ] || fail 'S3_BUCKET is required when offsite backup is enabled'
  is_placeholder "$s3_bucket" && fail 'S3_BUCKET contains a placeholder, so uploads would target a bucket that does not exist'
  is_placeholder "$s3_access_key" && fail 'S3_ACCESS_KEY_ID contains a placeholder'
  is_placeholder "$s3_secret_key" && fail 'S3_SECRET_ACCESS_KEY contains a placeholder'
  is_placeholder "$s3_endpoint" && fail 'S3_ENDPOINT contains a placeholder'
  is_placeholder "$s3_prefix" && fail 'S3_PREFIX contains a placeholder'
  is_placeholder "$s3_sse" && fail 'S3_SSE contains a placeholder'
  is_placeholder "$s3_sse_kms_key_id" && fail 'S3_SSE_KMS_KEY_ID contains a placeholder'

  case "$s3_endpoint" in
    http://*|https://*) ;;
    '') ;;
    *) fail 'S3_ENDPOINT must use http:// or https://' ;;
  esac
  case "$s3_endpoint" in
    *[[:space:]]*) fail 'S3_ENDPOINT must not contain whitespace' ;;
  esac
  case "$s3_prefix" in
    *[!A-Za-z0-9._/-]*) fail 'S3_PREFIX contains unsupported characters' ;;
  esac
  case "$s3_sse" in
    AES256|aws:kms) ;;
    *) fail 'S3_SSE must be AES256 or aws:kms' ;;
  esac
  if [ "$s3_sse" = aws:kms ]; then
    [ -n "$s3_sse_kms_key_id" ] || fail 'S3_SSE_KMS_KEY_ID is required for aws:kms'
  fi

  # Credentials are either explicit or handed to the container by the platform
  # (ECS task role, EKS web identity, instance profile, shared profile). Only
  # requiring static keys would make the most secure deployment shape impossible
  # to deploy at all, which is a good way to get the requirement switched off.
  if [ -n "$s3_access_key" ] || [ -n "$s3_secret_key" ]; then
    if [ -z "$s3_access_key" ] || [ -z "$s3_secret_key" ]; then
      fail 'S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must both be set, or both be left empty to use an instance/task role'
    fi
  else
    _vc_have_role=false
    for _vc_var in AWS_ACCESS_KEY_ID AWS_CONTAINER_CREDENTIALS_RELATIVE_URI AWS_WEB_IDENTITY_TOKEN_FILE AWS_ROLE_ARN AWS_PROFILE; do
      eval "_vc_val=\${$_vc_var:-}"
      if [ -n "$_vc_val" ]; then _vc_have_role=true; fi
    done
    if [ "$_vc_have_role" != true ]; then
      fail 'no S3 credentials: set S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or run with an instance/task role (AWS_ACCESS_KEY_ID, AWS_CONTAINER_CREDENTIALS_RELATIVE_URI, AWS_WEB_IDENTITY_TOKEN_FILE, AWS_ROLE_ARN or AWS_PROFILE)'
    fi
  fi

  command -v aws >/dev/null 2>&1 || fail 'aws CLI is not available, so no offsite copy can be made'
  s3_active=true
  printf '[backup] offsite destination: s3://%s/%s (required=%s)\n' "$s3_bucket" "${s3_prefix#/}" "$_vo_required"
}

is_true() {
  case "$1" in
    true|TRUE|1|yes|YES) return 0 ;;
    false|FALSE|0|no|NO) return 1 ;;
    *) return 2 ;;
  esac
}

mkdir -p "$backup_dir" || {
  printf '[backup] ERROR: cannot create %s\n' "$backup_dir" >&2
  exit 1
}

case "$retention_days" in
  ''|*[!0-9]*) fail 'BACKUP_RETENTION_DAYS must be a positive integer' ;;
esac
[ "$retention_days" -gt 0 ] || fail 'BACKUP_RETENTION_DAYS must be a positive integer'

# --- backup target: derived from DATABASE_URL, never hardcoded -----------------
#
# The app (web/worker/migrate) connects through DATABASE_URL. When this sidecar
# carried its own PGHOST=db, pointing DATABASE_URL at an external Postgres made
# the backup silently dump the empty local `db` service instead of production
# data — a backup that looks green and protects nothing. DATABASE_URL is the one
# source of truth; PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE are cleared below
# so no second source can disagree with it.

database_url=${DATABASE_URL:-}

# Comma-separated allow-list of hosts this backup is permitted to target. The
# default is the compose `db` service name, so the bundled single-host
# deployment works untouched while any external database must be acknowledged
# explicitly.
expected_host=${BACKUP_EXPECTED_HOST:-db}

database_url_parse "$database_url" "$expected_host" ||
  fail "$DATABASE_URL_ERROR; set BACKUP_EXPECTED_HOST to acknowledge this target, or the backup would target the wrong database"
url_host=$DATABASE_URL_HOST
database_url_check_identifier "$DATABASE_URL_DATABASE" ||
  fail "DATABASE_URL database name '$DATABASE_URL_DATABASE' is not a usable identifier"

# Hand libpq the URI itself rather than reassembling PG* variables: it decodes
# percent-escapes, IPv6 and sslmode parameters correctly, which hand-rolled
# parsing silently gets wrong. Exported through PGDATABASE (not argv) so the
# credential does not show up in `ps` inside the container.
unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSERVICE PGSERVICEFILE PGREALM 2>/dev/null || true
PGDATABASE=$database_url
export PGDATABASE
printf '[backup] target host=%s db=%s (allowed: %s)\n' \
  "$url_host" "$DATABASE_URL_DATABASE" "$expected_host"

# Fail before the lock and before pg_dump: an offsite misconfiguration must be
# reported in milliseconds, not after a full local dump has been written.
validate_offsite_config

lock_acquire || fail 'another backup run is active'
trap cleanup 0

stamp=$(date -u +%Y%m%dT%H%M%SZ)
file_name="void-$stamp.dump"
file="$backup_dir/$file_name"
checksum="$file.sha256"

if ! pg_dump -Fc --no-owner --no-privileges -f "$file"; then
  fail 'pg_dump failed'
fi
[ -s "$file" ] || fail 'pg_dump produced an empty file'

if ! (cd "$backup_dir" && sha256sum "$file_name" > "$(basename "$checksum").tmp.$$"); then
  fail 'SHA-256 generation failed'
fi
mv -f "$backup_dir/$(basename "$checksum").tmp.$$" "$checksum"

if ! pg_restore --list "$file" >/dev/null; then
  fail 'pg_restore --list verification failed'
fi

# All offsite/S3 configuration was validated up front by
# validate_offsite_config, before the lock and before pg_dump. Re-checking it
# here would only duplicate the policy and risk the two copies disagreeing.

if [ "$s3_active" = true ]; then
  # Only export explicit keys when they were actually supplied. Exporting them
  # empty would shadow the instance/task role credentials that
  # validate_offsite_config just accepted, and the upload would fail with a
  # confusing credential error instead of using the role.
  if [ -n "$s3_access_key" ]; then
    AWS_ACCESS_KEY_ID=$s3_access_key
    AWS_SECRET_ACCESS_KEY=$s3_secret_key
    export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
  fi
  AWS_DEFAULT_REGION=$s3_region
  AWS_REGION=$s3_region
  export AWS_DEFAULT_REGION AWS_REGION
  if [ "${S3_PATH_STYLE:-true}" = true ]; then
    AWS_S3_FORCE_PATH_STYLE=true
    export AWS_S3_FORCE_PATH_STYLE
  fi
  normalized_prefix=${s3_prefix#/}
  normalized_prefix=${normalized_prefix%/}
  if [ -n "$normalized_prefix" ]; then
    object_key="$normalized_prefix/$file_name"
  else
    object_key=$file_name
  fi
  dump_destination="s3://$s3_bucket/$object_key"
  checksum_destination="$dump_destination.sha256"

  s3_upload() {
    upload_source=$1
    upload_destination=$2
    if [ -n "$s3_endpoint" ]; then
      if [ "$s3_sse" = aws:kms ]; then
        aws --endpoint-url "$s3_endpoint" s3 cp "$upload_source" "$upload_destination" --sse "$s3_sse" --sse-kms-key-id "$s3_sse_kms_key_id" --only-show-errors
      else
        aws --endpoint-url "$s3_endpoint" s3 cp "$upload_source" "$upload_destination" --sse "$s3_sse" --only-show-errors
      fi
    elif [ "$s3_sse" = aws:kms ]; then
      aws s3 cp "$upload_source" "$upload_destination" --sse "$s3_sse" --sse-kms-key-id "$s3_sse_kms_key_id" --only-show-errors
    else
      aws s3 cp "$upload_source" "$upload_destination" --sse "$s3_sse" --only-show-errors
    fi
  }

  if ! s3_upload "$file" "$dump_destination"; then
    fail 'required off-host backup upload failed'
  fi
  if ! s3_upload "$checksum" "$checksum_destination"; then
    fail 'required off-host checksum upload failed'
  fi
  backup_location="s3://$s3_bucket/$object_key"
else
  backup_location=local
fi

if ! find "$backup_dir" -type f \( -name 'void-*.dump' -o -name 'void-*.dump.sha256' \) -mtime "+$retention_days" -delete; then
  fail 'retention cleanup failed'
fi

size_bytes=$(wc -c < "$file" | awk '{print $1}')
success_epoch=$(date -u +%s)
write_status "OK $success_epoch $stamp $file_name $size_bytes $backup_location"
printf '[backup] completed %s\n' "$file"
