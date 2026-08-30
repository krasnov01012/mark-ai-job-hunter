#!/bin/sh
# Create and validate one fresh PostgreSQL+n8n backup pair, then print exactly
# one opaque deploy reference on stdout. All diagnostics go to stderr.
set -eu

[ "$(id -u)" -eq 0 ] || {
    echo "run as root" >&2
    exit 1
}

deploy_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
# shellcheck disable=SC1091
. "$deploy_dir/scripts/common.sh"
load_non_secret_paths >&2

exec 9>/run/lock/mark-deploy-backup.lock
flock -n 9 || {
    echo "MARK_DEPLOY_BACKUP=blocked:lock-held" >&2
    exit 1
}

if find "$MARK_BACKUP_DIR" -maxdepth 1 -type f -name '*.partial' | grep -q .; then
    echo "MARK_DEPLOY_BACKUP=blocked:partial-present" >&2
    exit 1
fi
if docker top mark-backup-1 -eo args 2>/dev/null |
    grep -E '(^|[[:space:]])(pg_dump|tar)([[:space:]]|$)' >/dev/null; then
    echo "MARK_DEPLOY_BACKUP=blocked:backup-active" >&2
    exit 1
fi

before_manifest="$(
    find "$MARK_BACKUP_DIR" -maxdepth 1 -type f -name 'mark-backup-*.manifest' \
        -printf '%T@ %p\n' | sort -nr | sed -n '1s/^[^ ]* //p'
)"
compose restart backup >/dev/null

attempt=0
manifest="$before_manifest"
while [ "$attempt" -lt 120 ]; do
    manifest="$(
        find "$MARK_BACKUP_DIR" -maxdepth 1 -type f -name 'mark-backup-*.manifest' \
            -printf '%T@ %p\n' | sort -nr | sed -n '1s/^[^ ]* //p'
    )"
    if [ -n "$manifest" ] && [ "$manifest" != "$before_manifest" ]; then
        break
    fi
    attempt=$((attempt + 1))
    sleep 1
done
if [ -z "$manifest" ] || [ "$manifest" = "$before_manifest" ]; then
    echo "MARK_DEPLOY_BACKUP=failed:manifest-timeout" >&2
    exit 1
fi

stamp="$(basename "$manifest" | sed 's/^mark-backup-//;s/[.]manifest$//')"
printf '%s\n' "$stamp" | grep -Eq '^[0-9]{8}T[0-9]{6}Z$' || {
    echo "MARK_DEPLOY_BACKUP=failed:invalid-stamp" >&2
    exit 1
}
dump="$MARK_BACKUP_DIR/mark-postgres-$stamp.dump"
archive="$MARK_BACKUP_DIR/mark-n8n-data-$stamp.tgz"
[ -f "$dump" ] && [ -f "$archive" ] || {
    echo "MARK_DEPLOY_BACKUP=failed:incomplete-pair" >&2
    exit 1
}

compose exec -T backup sh -c '
    set -eu
    stamp="$1"
    cd /backups
    grep -E "^[0-9a-f]{64}  mark-(postgres|n8n-data)-" \
        "mark-backup-${stamp}.manifest" | sha256sum -c - >/dev/null
    pg_restore --list "mark-postgres-${stamp}.dump" >/dev/null
    tar -tzf "mark-n8n-data-${stamp}.tgz" >/dev/null
' sh "$stamp" </dev/null

echo "MARK_DEPLOY_BACKUP=passed" >&2
printf 'mark:%s\n' "$stamp"
