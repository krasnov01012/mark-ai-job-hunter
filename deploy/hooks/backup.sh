#!/bin/sh
set -eu

: "${PROJECT_DIR:?PROJECT_DIR is required}"
helper="$PROJECT_DIR/deploy/mark/scripts/deploy-backup-reference.sh"
[ -x "$helper" ] || {
    echo "MARK deploy backup helper is unavailable" >&2
    exit 1
}

reference="$(sudo -n "$helper")"
case "$reference" in
    mark:[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;;
    *) echo "MARK backup helper returned an invalid reference" >&2; exit 1 ;;
esac
printf '%s\n' "$reference"
