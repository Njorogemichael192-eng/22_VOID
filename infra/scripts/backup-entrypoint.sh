#!/bin/sh
set -eu

umask 077
backup_dir=${BACKUP_DIR:-/backups}
mkdir -p "$backup_dir"

/usr/local/bin/backup.sh

schedule=${BACKUP_SCHEDULE:-0 2 * * *}
case "$schedule" in
  *'
'*|*'
'*) printf '%s\n' 'BACKUP_SCHEDULE must be a single five-field cron expression' >&2; exit 1 ;;
esac
invalid=$(printf '%s' "$schedule" | tr -d '-0-9A-Za-z*/?,# ')
[ -z "$invalid" ] || {
  printf '%s\n' 'BACKUP_SCHEDULE contains unsupported characters' >&2
  exit 1
}
if ! printf '%s\n' "$schedule" | awk 'NF != 5 { exit 1 }'; then
  printf '%s\n' 'BACKUP_SCHEDULE must contain exactly five fields' >&2
  exit 1
fi

printf '%s\n' "$schedule /usr/local/bin/backup.sh" > /etc/crontabs/root
chmod 600 /etc/crontabs/root
exec crond -f -l 6
