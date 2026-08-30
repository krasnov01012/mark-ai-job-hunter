#!/bin/sh
# Restore the exact backup pair created before checkout, update the external
# deployed-commit marker, then start the old checked-out runtime.
set -eu

rollback_tag="${1:-}"
backup_reference="${2:-}"
[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }
printf '%s\n' "$rollback_tag" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' || {
    echo "invalid rollback tag" >&2; exit 1;
}
case "$backup_reference" in
    mark:[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;;
    *) echo "invalid MARK backup reference" >&2; exit 1 ;;
esac
stamp="${backup_reference#mark:}"

deploy_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
# shellcheck disable=SC1091
. "$deploy_dir/scripts/common.sh"
load_non_secret_paths >/dev/null

set -a
# shellcheck disable=SC1090
. "$env_file"
set +a

manifest="$MARK_BACKUP_DIR/mark-backup-$stamp.manifest"
dump="$MARK_BACKUP_DIR/mark-postgres-$stamp.dump"
archive="$MARK_BACKUP_DIR/mark-n8n-data-$stamp.tgz"
for file in "$manifest" "$dump" "$archive"; do
    [ -f "$file" ] || { echo "missing MARK rollback artifact" >&2; exit 1; }
done

(
    cd "$MARK_BACKUP_DIR"
    grep -E "^[0-9a-f]{64}  mark-(postgres|n8n-data)-" \
        "$(basename "$manifest")" | sha256sum -c - >/dev/null
)
compose exec -T backup pg_restore --list "/backups/$(basename "$dump")" >/dev/null
compose exec -T backup tar -tzf "/backups/$(basename "$archive")" >/dev/null

deployed_commit="$(sed -n 's/^deployed_commit=//p' "$manifest")"
printf '%s\n' "$deployed_commit" | grep -Eq '^[a-f0-9]{40}$' || {
    echo "backup manifest has no valid deployed commit" >&2
    exit 1
}

exec 9>/run/lock/mark-deploy-rollback.lock
flock -n 9 || { echo "MARK_DEPLOY_ROLLBACK=blocked:lock-held" >&2; exit 1; }

compose stop n8n backup >/dev/null
compose up -d postgres >/dev/null
attempt=0
until compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    [ "$attempt" -lt 30 ] || { echo "PostgreSQL did not become ready" >&2; exit 1; }
    sleep 1
done

compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
    pg_restore --clean --if-exists --exit-on-error --no-owner --no-privileges \
    --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <"$dump"

archive_name="$(basename "$archive")"
compose run --rm --no-deps --user 0:0 \
    --volume "$MARK_BACKUP_DIR:/restore:ro" \
    --entrypoint /bin/sh n8n -c '
        set -eu
        archive_name="$1"
        find /home/node/.n8n -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
        tar -xzf "/restore/$archive_name" -C /home/node/.n8n
        chown -R node:node /home/node/.n8n
    ' sh "$archive_name" >/dev/null

"$deploy_dir/scripts/deploy-env-commit.sh" "$deployed_commit"
"$deploy_dir/scripts/start.sh"
echo "MARK_DEPLOY_ROLLBACK=passed:$rollback_tag"
