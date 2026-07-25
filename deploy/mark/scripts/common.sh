#!/bin/sh
set -eu

deploy_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
env_file="${MARK_ENV_FILE:-/etc/mark/mark.env}"

compose() {
  docker compose --env-file "$env_file" -f "$deploy_dir/compose.yaml" "$@"
}

require_environment() {
  "$deploy_dir/scripts/check-env.sh"
}

load_non_secret_paths() {
  require_environment

  MARK_MIGRATION_DIR="$(
    sed -n 's/^MARK_MIGRATION_DIR=//p' "$env_file" | tail -n 1
  )"
  MARK_BACKUP_DIR="$(
    sed -n 's/^MARK_BACKUP_DIR=//p' "$env_file" | tail -n 1
  )"
  export MARK_MIGRATION_DIR MARK_BACKUP_DIR
}
