#!/bin/sh
set -eu

umask 077
mkdir -p /backups

interval="${BACKUP_INTERVAL_SECONDS:-86400}"
retention="${BACKUP_RETENTION_DAYS:-14}"

case "$interval" in
  *[!0-9]*|'') echo "BACKUP_INTERVAL_SECONDS must be a positive integer" >&2; exit 1 ;;
esac
case "$retention" in
  *[!0-9]*|'') echo "BACKUP_RETENTION_DAYS must be a positive integer" >&2; exit 1 ;;
esac

while true; do
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  database_tmp="/backups/mark-postgres-${stamp}.dump.partial"
  database_final="/backups/mark-postgres-${stamp}.dump"
  n8n_tmp="/backups/mark-n8n-data-${stamp}.tgz.partial"
  n8n_final="/backups/mark-n8n-data-${stamp}.tgz"

  if pg_dump --format=custom --file="$database_tmp"; then
    mv "$database_tmp" "$database_final"
  else
    rm -f "$database_tmp"
    echo "PostgreSQL backup failed at ${stamp}" >&2
  fi

  if tar -C /n8n-data -czf "$n8n_tmp" .; then
    mv "$n8n_tmp" "$n8n_final"
  else
    rm -f "$n8n_tmp"
    echo "n8n data backup failed at ${stamp}" >&2
  fi

  find /backups -type f \
    \( -name 'mark-postgres-*.dump' -o -name 'mark-n8n-data-*.tgz' \) \
    -mtime "+$retention" -delete

  sleep "$interval"
done
