#!/bin/sh
set -eu

deploy_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$deploy_dir"

mkdir -p runtime/backups runtime/migration/entities
chmod 700 runtime runtime/backups runtime/migration runtime/migration/entities

if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  echo "Created $deploy_dir/.env from the safe template."
  echo "Fill the placeholders and copy the exact source N8N_ENCRYPTION_KEY before continuing."
else
  chmod 600 .env
  echo "$deploy_dir/.env already exists; it was not overwritten."
fi
