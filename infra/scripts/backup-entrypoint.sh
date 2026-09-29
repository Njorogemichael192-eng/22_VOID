#!/bin/sh
# Backup sidecar supervisor.
#
# Docker's `restart:` policy only reacts to the container's main process exiting.
# A healthcheck flipping to `unhealthy` does nothing on its own: the container
# keeps its `running` state, `docker compose ps` looks healthy, and a sidecar
# whose cron daemon had died would sit there producing no backups indefinitely.
# This supervisor therefore runs the same probe the healthcheck uses and exits
# non-zero when the container is genuinely wedged, so `restart: unless-stopped`
# actually engages.
#
# The important distinction is "wedged" versus "failing loudly". Restarting can
# only cure a dead scheduler. A backup run that happened and reported FAILED is a
# *reported* failure — a broken bucket, an unreachable database — and no restart
# will fix it, so treating it as a wedge would turn one bad night into a
# permanent crash loop re-attempting the broken endpoint every minute, forever.
set -eu

umask 077
backup_dir=${BACKUP_DIR:-/backups}
mkdir -p "$backup_dir"

# Overridable so the supervisor's control flow is testable off-target. Defaults
# are the in-image paths and are unchanged.
backup_script=${BACKUP_SCRIPT:-/usr/local/bin/backup.sh}
health_script=${BACKUP_HEALTH_SCRIPT:-/usr/local/bin/backup-health.sh}
crontab_file=${BACKUP_CRONTAB_FILE:-/etc/crontabs/root}
crond_bin=${BACKUP_CROND_BIN:-crond}

status_file=${BACKUP_STATUS_FILE:-$backup_dir/status}

# "No backup run of any outcome for this long" is the wedge condition. Defaults
# to the same window the healthcheck uses, so the watchdog never restarts a
# container the healthcheck still calls healthy.
watchdog_stale=${BACKUP_WATCHDOG_STALE_SECONDS:-${BACKUP_MAX_AGE_SECONDS:-129600}}
interval=${BACKUP_WATCHDOG_INTERVAL_SECONDS:-60}
max_failures=${BACKUP_WATCHDOG_MAX_FAILURES:-3}
watchdog_enabled=${BACKUP_WATCHDOG_ENABLED:-true}

# Validated rather than trusted: a garbage value here would make `sleep` fail on
# every iteration and spin this loop as fast as the CPU allows.
for _wv in "$watchdog_stale" "$interval" "$max_failures"; do
  case "$_wv" in
    ''|*[!0-9]*) printf '%s\n' "backup watchdog intervals must be positive integers, got: $_wv" >&2; exit 1 ;;
  esac
  [ "$_wv" -gt 0 ] || { printf '%s\n' "backup watchdog intervals must be positive integers, got: $_wv" >&2; exit 1; }
done

# Runs once at boot. A failure here exits non-zero and the restart policy retries:
# a misconfigured destination should be loud, not silently tolerated.
"$backup_script"

schedule=${BACKUP_SCHEDULE:-0 2 * * *}
case "$schedule" in
  *'
'*)
    printf '%s\n' 'BACKUP_SCHEDULE must be a single five-field cron expression' >&2
    exit 1
    ;;
esac
# The deletion set ends with `-` rather than starting with it. As written
# originally (`'-0-9A-Za-z*/?,# '`) GNU tr parses the leading `-0` as options and
# exits 1; because this is a plain assignment the command substitution's status
# becomes the assignment's status, so `set -e` aborted the sidecar at startup. The
# image installs GNU coreutils, and Alpine's PATH puts /usr/bin ahead of the
# busybox /bin, so this was the tr that actually ran in production.
invalid=$(printf '%s' "$schedule" | tr -d '0-9A-Za-z*/?,# -')
[ -z "$invalid" ] || {
  printf '%s\n' 'BACKUP_SCHEDULE contains unsupported characters' >&2
  exit 1
}
if ! printf '%s\n' "$schedule" | awk 'NF != 5 { exit 1 }'; then
  printf '%s\n' 'BACKUP_SCHEDULE must contain exactly five fields' >&2
  exit 1
fi

printf '%s\n' "$schedule $backup_script" > "$crontab_file"
chmod 600 "$crontab_file"

if [ "$watchdog_enabled" != true ]; then
  # Original behaviour: crond is PID 1 and receives signals directly.
  printf '%s\n' '[backup] watchdog disabled; crond runs as PID 1'
  exec "$crond_bin" -f -l 6
fi

# Backgrounded so the loop below can poll it. If it dies immediately the first
# liveness check catches it and the container restarts.
"$crond_bin" -f -l 6 &
crond_pid=$!

stopping=false
shutdown() {
  # Exit 0 for a requested stop so `restart: unless-stopped` does not treat an
  # operator-initiated shutdown as a crash and bounce the container.
  stopping=true
  if [ -n "$crond_pid" ]; then
    kill -TERM "$crond_pid" 2>/dev/null || true
  fi
  exit 0
}
trap shutdown TERM INT

# `sleep` in the foreground is not reliably interruptible by a trap in every
# /bin/sh; backgrounding it and waiting on the pid is the portable way to make
# the wait itself interruptible.
pause() {
  sleep "$1" &
  _pause_pid=$!
  wait "$_pause_pid" 2>/dev/null || true
}

# Seconds since the last recorded backup run, of either outcome. Prints nothing
# when there is no usable timestamp, which the caller treats as "unknown" and
# never as proof of a wedge.
last_run_age() {
  _lr_result=''
  _lr_epoch=''
  _lr_rest=''
  [ -s "$status_file" ] || return 0
  IFS=' ' read -r _lr_result _lr_epoch _lr_rest < "$status_file" || true
  case "$_lr_epoch" in
    ''|*[!0-9]*) return 0 ;;
  esac
  _lr_now=$(date -u +%s)
  printf '%s\n' "$((_lr_now - _lr_epoch))"
}

printf '[backup] watchdog active: interval=%ss max_failures=%s stale=%ss\n' \
  "$interval" "$max_failures" "$watchdog_stale"

# A dead child is not detectable by its pid alone: it stays a zombie until the
# parent reaps it, and `kill -0` succeeds against a zombie. Checking only the pid
# would therefore miss a crashed crond entirely and fall back to waiting out the
# whole stale window. Field 3 of /proc/<pid>/stat is the process state; Z is
# defunct. Where /proc is not readable the pid check stands alone.
crond_alive() {
  kill -0 "$crond_pid" 2>/dev/null || return 1
  if [ -r "/proc/$crond_pid/stat" ]; then
    _ca_state=$(awk '{ print $3 }' "/proc/$crond_pid/stat" 2>/dev/null || true)
    [ "$_ca_state" = Z ] && return 1
  fi
  return 0
}

failures=0
verdict_logged=false

while :; do
  pause "$interval"
  [ "$stopping" = true ] && break

  # A dead scheduler is the unambiguous wedge, and the cheapest thing to detect.
  if ! crond_alive; then
    printf '%s\n' '[backup] crond is no longer running; exiting so the restart policy can recover the container' >&2
    exit 1
  fi

  if "$health_script" >/dev/null 2>&1; then
    failures=0
    verdict_logged=false
    continue
  fi

  failures=$((failures + 1))
  if [ "$failures" -eq 1 ]; then
    printf '%s\n' '[backup] health probe failing; watching for a persistent wedge' >&2
  fi
  [ "$failures" -lt "$max_failures" ] && continue
  [ "$verdict_logged" = true ] && continue
  verdict_logged=true

  age=$(last_run_age)
  if [ -n "$age" ] && [ "$age" -ge "$watchdog_stale" ]; then
    # No successful or failed run for the whole window: cron is not firing at
    # all. A restart is the only available remedy.
    printf '%s\n' "[backup] no backup run in ${age}s (limit ${watchdog_stale}s) while unhealthy; the scheduler is wedged, exiting so the container restarts" >&2
    exit 1
  fi

  # Either a run happened recently (and its own status file is the report) or the
  # timestamp is unreadable. Staying up is correct: the failure is already
  # surfaced, and restarting would only re-run the same doomed backup.
  #
  # The streak is deliberately NOT reset here. Resetting would re-log the verdict
  # every max_failures intervals for as long as the outage lasted, which on a
  # 36h window is hundreds of identical lines. It resets when health recovers.
  if [ -n "$age" ]; then
    printf '%s\n' "[backup] unhealthy but a backup ran ${age}s ago; leaving the container up so the failure stays visible instead of crash-looping" >&2
  else
    printf '%s\n' "[backup] unhealthy and no readable run timestamp; leaving the container up rather than restarting a scheduler that may be fine" >&2
  fi
done
