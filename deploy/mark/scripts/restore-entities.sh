#!/bin/sh
set -eu

deploy_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$deploy_dir"

# shellcheck disable=SC1091
. "$deploy_dir/scripts/common.sh"
load_non_secret_paths

entities_dir="$MARK_MIGRATION_DIR/entities"
ready_marker="$MARK_MIGRATION_DIR/READY"
restored_marker="$MARK_MIGRATION_DIR/RESTORED"

if [ ! -f "$ready_marker" ]; then
  echo "Missing external migration READY marker. Finish the secure upload first." >&2
  exit 1
fi

if [ -f "$restored_marker" ]; then
  echo "Entities were already restored. Remove RESTORED only after taking a backup and reviewing the target database." >&2
  exit 1
fi

if ! find "$entities_dir" -type f -print -quit | grep -q .; then
  echo "No entity export files found in $entities_dir." >&2
  exit 1
fi

compose stop n8n backup >/dev/null 2>&1 || true
compose up -d postgres

attempt=0
until compose exec -T postgres sh -c \
  'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "PostgreSQL did not become healthy." >&2
    exit 1
  fi
  sleep 2
done

compose run --rm --no-deps -u node \
  -v "$entities_dir:/opt/mark/import" \
  n8n \
  import:entities --inputDir=/opt/mark/import --truncateTables true

compose run --rm --no-deps -u node n8n \
  unpublish:workflow --all

touch "$restored_marker"
chmod 600 "$restored_marker"

compose up -d n8n backup
echo "Entities restored and all workflows left unpublished."
echo "Run verify.sh, perform credential smokes, then publish-main.sh."
