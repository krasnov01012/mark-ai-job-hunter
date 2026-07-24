#!/bin/sh
set -eu

deploy_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$deploy_dir"

./scripts/check-env.sh

set -a
# shellcheck disable=SC1091
. ./.env
set +a

entities_dir="$deploy_dir/runtime/migration/entities"
ready_marker="$deploy_dir/runtime/migration/READY"
restored_marker="$deploy_dir/runtime/migration/RESTORED"

if [ ! -f "$ready_marker" ]; then
  echo "Missing runtime/migration/READY. Finish the secure upload before restoring." >&2
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

docker compose stop n8n backup >/dev/null 2>&1 || true
docker compose up -d postgres

attempt=0
until docker compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "PostgreSQL did not become healthy." >&2
    exit 1
  fi
  sleep 2
done

docker compose run --rm --no-deps -u node \
  -v "$entities_dir:/opt/mark/migration/entities" \
  n8n \
  import:entities --inputDir=/opt/mark/migration/entities --truncateTables true

docker compose run --rm --no-deps -u node n8n \
  unpublish:workflow --all

touch "$restored_marker"
chmod 600 "$restored_marker"

docker compose up -d n8n backup
echo "Entities restored and all workflows left unpublished."
echo "Run verify.sh, perform credential smokes, then publish-main.sh."
