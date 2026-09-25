#!/bin/sh
set -eu

/usr/local/bin/validate-env.sh
exec "$@"
