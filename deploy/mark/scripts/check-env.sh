#!/bin/sh
set -eu

deploy_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
env_file="${MARK_ENV_FILE:-/etc/mark/mark.env}"

if [ ! -f "$env_file" ]; then
  echo "Missing MARK environment file. Prepare /etc/mark/mark.env first." >&2
  exit 1
fi

resolved_env="$(readlink -f "$env_file")"
case "$resolved_env" in
  "$deploy_dir"/*)
    echo "The secret environment file must stay outside the deployment tree." >&2
    exit 1
    ;;
esac

permissions="$(stat -c '%a' "$env_file" 2>/dev/null || true)"
if [ "$permissions" != "600" ]; then
  echo "MARK environment file must have mode 600; current mode is ${permissions:-unknown}." >&2
  exit 1
fi

owner_uid="$(stat -c '%u' "$env_file" 2>/dev/null || true)"
if [ "$owner_uid" != "0" ]; then
  echo "MARK environment file must be owned by root." >&2
  exit 1
fi

if grep -Eq 'CHANGE_ME|example\.(com|ts\.net)|<[^>]+>' "$env_file"; then
  echo "MARK environment file still contains placeholders." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$env_file"
set +a

required_vars="
POSTGRES_DB
POSTGRES_USER
POSTGRES_PASSWORD
N8N_ENCRYPTION_KEY
MARK_TELEGRAM_CHAT_ID
N8N_HOST
N8N_PROTOCOL
WEBHOOK_URL
N8N_EDITOR_BASE_URL
MARK_MIGRATION_DIR
MARK_BACKUP_DIR
MARK_DEPLOYED_COMMIT
"

for name in $required_vars; do
  eval "value=\${$name:-}"
  if [ -z "$value" ]; then
    echo "$name is required in $env_file." >&2
    exit 1
  fi
done

if [ "${#POSTGRES_PASSWORD}" -lt 32 ]; then
  echo "POSTGRES_PASSWORD must be at least 32 characters." >&2
  exit 1
fi

if [ "${#N8N_ENCRYPTION_KEY}" -lt 32 ]; then
  echo "N8N_ENCRYPTION_KEY must be at least 32 characters." >&2
  exit 1
fi

if ! printf '%s\n' "$MARK_TELEGRAM_CHAT_ID" | grep -Eq '^-?[0-9]+$'; then
  echo "MARK_TELEGRAM_CHAT_ID must be numeric." >&2
  exit 1
fi

case "$MARK_MIGRATION_DIR" in
  /*) ;;
  *) echo "MARK_MIGRATION_DIR must be an absolute external path." >&2; exit 1 ;;
esac
case "$MARK_BACKUP_DIR" in
  /*) ;;
  *) echo "MARK_BACKUP_DIR must be an absolute external path." >&2; exit 1 ;;
esac
case "$MARK_MIGRATION_DIR:$MARK_BACKUP_DIR" in
  *"$deploy_dir"*)
    echo "Migration and backup paths must stay outside the deployment tree." >&2
    exit 1
    ;;
esac
if [ "$MARK_MIGRATION_DIR" = "$MARK_BACKUP_DIR" ]; then
  echo "Migration and backup paths must be different." >&2
  exit 1
fi

if ! printf '%s\n' "$MARK_DEPLOYED_COMMIT" | grep -Eq '^[a-f0-9]{40}$'; then
  echo "MARK_DEPLOYED_COMMIT must be a full Git commit SHA." >&2
  exit 1
fi

if [ "$N8N_PROTOCOL" = "https" ]; then
  case "$WEBHOOK_URL" in https://*/) ;; *) echo "WEBHOOK_URL must use https." >&2; exit 1 ;; esac
  case "$N8N_EDITOR_BASE_URL" in https://*/) ;; *) echo "N8N_EDITOR_BASE_URL must use https." >&2; exit 1 ;; esac
fi

echo "MARK container environment contract is valid."
