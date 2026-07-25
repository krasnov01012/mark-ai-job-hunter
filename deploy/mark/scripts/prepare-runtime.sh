#!/bin/sh
set -eu

deploy_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
env_file="${MARK_ENV_FILE:-/etc/mark/mark.env}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run prepare-runtime.sh through sudo under the agentops SSH session." >&2
  exit 1
fi

if ! getent group mark >/dev/null 2>&1; then
  echo "Required host group mark does not exist." >&2
  exit 1
fi

install -d -o root -g mark -m 0750 /etc/mark
install -d -o root -g mark -m 0750 /var/lib/mark
install -d -o root -g mark -m 0750 /var/lib/mark/migration
install -d -o root -g mark -m 0750 /var/lib/mark/migration/entities
install -d -o root -g root -m 0700 /var/lib/mark/backups

if [ ! -f "$env_file" ]; then
  install -o root -g root -m 0600 "$deploy_dir/.env.example" "$env_file"
  echo "Created the external MARK environment template."
  echo "Fill placeholders from the protected reconstructed recovery bundle before continuing."
else
  chown root:root "$env_file"
  chmod 600 "$env_file"
  echo "External MARK environment already exists; it was not overwritten."
fi

echo "Prepared external migration and backup directories."
