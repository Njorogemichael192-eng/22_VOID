#!/bin/sh
set -eu

umask 077

backup_dir=${BACKUP_DIR:-/backups}
retention_days=${BACKUP_RETENTION_DAYS:-14}
status_file=${BACKUP_STATUS_FILE:-$backup_dir/status}
lock_dir=${BACKUP_LOCK_DIR:-$backup_dir/.backup.lock}
s3_enabled=${S3_ENABLED:-false}
offhost_required=${BACKUP_REQUIRE_OFFHOST:-${BACKUP_OFFHOST_REQUIRED:-false}}
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
  rmdir "$lock_dir" 2>/dev/null || true
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

if ! mkdir "$lock_dir" 2>/dev/null; then
  fail 'another backup run is active'
fi
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

if [ "$s3_enabled" != false ] && [ "$s3_enabled" != FALSE ] && [ "$s3_enabled" != 0 ] && [ "$s3_enabled" != no ] && [ "$s3_enabled" != NO ]; then
  if is_true "$s3_enabled"; then
    :
  else
    status=$(is_true "$s3_enabled"; printf '%s' "$?")
    [ "$status" -ne 2 ] || fail 'S3_ENABLED must be true or false'
  fi
fi

required_state=$(is_true "$offhost_required"; printf '%s' "$?")
[ "$required_state" -ne 2 ] || fail 'BACKUP_REQUIRE_OFFHOST must be true or false'

if [ -n "$s3_bucket" ] || is_true "$s3_enabled" || is_true "$offhost_required"; then
  [ -n "$s3_bucket" ] || fail 'S3_BUCKET is required when off-host backup is enabled'
  is_placeholder "$s3_bucket" && fail 'S3_BUCKET contains a placeholder'
  [ -n "$s3_access_key" ] || fail 'S3_ACCESS_KEY_ID is required when off-host backup is enabled'
  [ -n "$s3_secret_key" ] || fail 'S3_SECRET_ACCESS_KEY is required when off-host backup is enabled'
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
  command -v aws >/dev/null 2>&1 || fail 'aws CLI is not available'
  AWS_ACCESS_KEY_ID=$s3_access_key
  AWS_SECRET_ACCESS_KEY=$s3_secret_key
  AWS_DEFAULT_REGION=$s3_region
  AWS_REGION=$s3_region
  AWS_EC2_METADATA_DISABLED=true
  export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_DEFAULT_REGION AWS_REGION AWS_EC2_METADATA_DISABLED
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
