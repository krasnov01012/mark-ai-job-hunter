#!/bin/sh
set -eu

deploy_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$deploy_dir"

./scripts/check-env.sh

workflow_id="RO4i4YmNzEzC2TEV"

docker compose exec -T -u node n8n n8n unpublish:workflow --all
docker compose exec -T -u node n8n n8n publish:workflow --id="$workflow_id"
docker compose restart n8n

attempt=0
until docker compose exec -T n8n node -e \
  "fetch('http://127.0.0.1:5678/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
  >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 45 ]; then
    echo "n8n did not recover after publishing the main workflow." >&2
    exit 1
  fi
  sleep 2
done

echo "Published only MARK workflow $workflow_id."
