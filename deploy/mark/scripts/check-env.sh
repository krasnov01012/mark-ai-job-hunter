#!/bin/sh
set -eu

deploy_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
env_file="$deploy_dir/.env"

if [ ! -f "$env_file" ]; then
  echo "Missing $env_file. Copy .env.example to .env and fill it on the server." >&2
  exit 1
fi

permissions="$(stat -c '%a' "$env_file" 2>/dev/null || true)"
if [ "$permissions" != "600" ]; then
  echo "$env_file must have mode 600; current mode is ${permissions:-unknown}." >&2
  exit 1
fi

if grep -Eq 'CHANGE_ME|example\.com|<[^>]+>' "$env_file"; then
  echo "$env_file still contains placeholders." >&2
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

if [ "$N8N_PROTOCOL" = "https" ]; then
  case "$WEBHOOK_URL" in https://*/) ;; *) echo "WEBHOOK_URL must use https." >&2; exit 1 ;; esac
  case "$N8N_EDITOR_BASE_URL" in https://*/) ;; *) echo "N8N_EDITOR_BASE_URL must use https." >&2; exit 1 ;; esac
fi

echo "MARK container environment contract is valid."
