#!/bin/sh
set -eu

rollback_tag="${1:-}"
backup_reference="${2:-}"
: "${PROJECT_DIR:?PROJECT_DIR is required}"

printf '%s\n' "$rollback_tag" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' || {
    echo "invalid MARK rollback tag" >&2
    exit 1
}
case "$backup_reference" in
    mark:[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;;
    *) echo "invalid MARK backup reference" >&2; exit 1 ;;
esac

helper="$PROJECT_DIR/deploy/mark/scripts/deploy-rollback.sh"
[ -x "$helper" ] || {
    echo "MARK deploy rollback helper is unavailable" >&2
    exit 1
}
sudo -n "$helper" "$rollback_tag" "$backup_reference"
