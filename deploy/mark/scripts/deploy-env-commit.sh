#!/bin/sh
# Root-only helper shared by deploy apply/rollback. It changes one non-secret
# field in the external env without printing or rewriting any secret value.
set -eu

commit="${1:-}"
printf '%s\n' "$commit" | grep -Eq '^[a-f0-9]{40}$' || {
    echo "invalid MARK deployed commit" >&2
    exit 1
}
[ "$(id -u)" -eq 0 ] || {
    echo "run as root" >&2
    exit 1
}

env_file="${MARK_ENV_FILE:-/etc/mark/mark.env}"
[ -f "$env_file" ] || {
    echo "MARK environment file is missing" >&2
    exit 1
}
env_dir="$(dirname "$env_file")"
tmp="$(mktemp "$env_dir/.mark-env.XXXXXX")"
cleanup() {
    rm -f "$tmp"
}
trap cleanup EXIT HUP INT TERM

if ! awk -v commit="$commit" '
    BEGIN { found=0 }
    /^MARK_DEPLOYED_COMMIT=/ {
        if (found) exit 42
        print "MARK_DEPLOYED_COMMIT=" commit
        found=1
        next
    }
    { print }
    END { if (!found) exit 43 }
' "$env_file" >"$tmp"; then
    echo "MARK_DEPLOYED_COMMIT must occur exactly once" >&2
    exit 1
fi

chown root:root "$tmp"
chmod 600 "$tmp"
mv -f "$tmp" "$env_file"
trap - EXIT HUP INT TERM
