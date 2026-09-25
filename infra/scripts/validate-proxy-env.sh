#!/bin/sh
set -eu

fail() {
  printf 'proxy environment validation failed: %s\n' "$1" >&2
  exit 1
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

validate_domain() {
  domain_value=$1
  [ -n "$domain_value" ] || fail 'DOMAIN is required'
  is_placeholder "$domain_value" && fail 'DOMAIN contains a placeholder'
  [ "${#domain_value}" -le 253 ] || fail 'DOMAIN is too long'
  case "$domain_value" in
    *.*) ;;
    *) fail 'DOMAIN must be a fully qualified domain name' ;;
  esac
  case "$domain_value" in
    *[!A-Za-z0-9.-]*|.*|*.|*..*)
      fail 'DOMAIN has invalid characters or labels'
      ;;
  esac
  old_ifs=$IFS
  IFS=.
  set -- $domain_value
  IFS=$old_ifs
  [ "$#" -ge 2 ] || fail 'DOMAIN must contain at least two labels'
  for label in "$@"; do
    case "$label" in
      -*|*-) fail 'DOMAIN labels cannot start or end with a hyphen' ;;
    esac
    case "$label" in
      *[!A-Za-z0-9-]*) fail 'DOMAIN has invalid characters' ;;
    esac
  done
}

validate_domain "${DOMAIN:-}"
email=${ACME_EMAIL:-}
[ -n "$email" ] || fail 'ACME_EMAIL is required'
is_placeholder "$email" && fail 'ACME_EMAIL contains a placeholder'
case "$email" in
  *[[:space:]]*|*/*|*\\*)
    fail 'ACME_EMAIL has invalid characters'
    ;;
esac
case "$email" in
  *@*.*) ;;
  *) fail 'ACME_EMAIL must be an email address' ;;
esac

exec caddy "$@"
