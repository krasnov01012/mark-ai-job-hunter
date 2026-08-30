#!/bin/sh
set -eu

target_tag="${1:-}"
target_commit="${2:-}"
: "${PROJECT_DIR:?PROJECT_DIR is required}"

printf '%s\n' "$target_tag" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' || {
    echo "invalid MARK target tag" >&2
    exit 1
}
printf '%s\n' "$target_commit" | grep -Eq '^[a-f0-9]{40}$' || {
    echo "invalid MARK target commit" >&2
    exit 1
}

helper="$PROJECT_DIR/deploy/mark/scripts/deploy-apply.sh"
[ -x "$helper" ] || {
    echo "MARK deploy apply helper is unavailable" >&2
    exit 1
}
sudo -n "$helper" "$target_tag" "$target_commit"
