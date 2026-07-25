#!/bin/sh
set -eu

deploy_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$deploy_dir"

# shellcheck disable=SC1091
. "$deploy_dir/scripts/common.sh"
load_non_secret_paths

if [ ! -f "$MARK_MIGRATION_DIR/RESTORED" ]; then
  echo "Migration is required but the external RESTORED marker is missing." >&2
  echo "Upload the reconstructed entity export and run restore-entities.sh first." >&2
  exit 1
fi

compose pull
compose up -d

attempt=0
until compose exec -T n8n node -e \
  "fetch('http://127.0.0.1:5678/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
  >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 45 ]; then
    echo "n8n did not become healthy." >&2
    compose ps
    exit 1
  fi
  sleep 2
done

echo "MARK containers are running. Workflows remain in their database state."
