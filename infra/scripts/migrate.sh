#!/bin/sh
set -eu

cd /app

[ -f package.json ] || {
  printf '%s\n' 'migration image is missing /app/package.json' >&2
  exit 1
}
[ -f prisma.config.ts ] || {
  printf '%s\n' 'migration image is missing /app/prisma.config.ts' >&2
  exit 1
}
[ -d prisma ] || {
  printf '%s\n' 'migration image is missing /app/prisma' >&2
  exit 1
}

exec npx --no-install prisma migrate deploy
