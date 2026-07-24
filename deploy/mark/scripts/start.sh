#!/bin/sh
set -eu

deploy_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$deploy_dir"

./scripts/check-env.sh
mkdir -p runtime/backups runtime/migration/entities
chmod 700 runtime runtime/backups runtime/migration runtime/migration/entities

set -a
# shellcheck disable=SC1091
. ./.env
set +a

if [ "${MIGRATION_REQUIRED:-true}" = "true" ] && [ ! -f runtime/migration/RESTORED ]; then
  echo "Migration is required but runtime/migration/RESTORED is missing." >&2
  echo "Upload the source entity export and run ./scripts/restore-entities.sh first." >&2
  exit 1
fi

docker compose pull
docker compose up -d

attempt=0
until docker compose exec -T n8n node -e \
  "fetch('http://127.0.0.1:5678/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
  >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 45 ]; then
    echo "n8n did not become healthy." >&2
    docker compose ps
    exit 1
  fi
  sleep 2
done

echo "MARK containers are running. Workflows remain in their database state."
