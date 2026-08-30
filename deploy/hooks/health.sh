#!/bin/sh
set -eu

port="${MARK_BIND_PORT:-5678}"
case "$port" in
    ''|*[!0-9]*) echo "MARK_BIND_PORT must be numeric" >&2; exit 1 ;;
esac

curl --silent --show-error --fail --max-time 10 \
    "http://127.0.0.1:$port/healthz" >/dev/null
