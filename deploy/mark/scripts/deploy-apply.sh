#!/bin/sh
set -eu

target_tag="${1:-}"
target_commit="${2:-}"
[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }
printf '%s\n' "$target_tag" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' || {
    echo "invalid target tag" >&2; exit 1;
}
printf '%s\n' "$target_commit" | grep -Eq '^[a-f0-9]{40}$' || {
    echo "invalid target commit" >&2; exit 1;
}

deploy_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
"$deploy_dir/scripts/check-env.sh" >/dev/null
"$deploy_dir/scripts/deploy-env-commit.sh" "$target_commit"
"$deploy_dir/scripts/start.sh"
echo "MARK_DEPLOY_APPLY=passed:$target_tag"
