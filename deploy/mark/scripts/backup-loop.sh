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
if [ "$interval" -eq 0 ] || [ "$retention" -eq 0 ]; then
  echo "Backup interval and retention must be greater than zero." >&2
  exit 1
fi

while true; do
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  database_tmp="/backups/mark-postgres-${stamp}.dump.partial"
  database_final="/backups/mark-postgres-${stamp}.dump"
  n8n_tmp="/backups/mark-n8n-data-${stamp}.tgz.partial"
  n8n_final="/backups/mark-n8n-data-${stamp}.tgz"
  manifest_tmp="/backups/mark-backup-${stamp}.manifest.partial"
  manifest_final="/backups/mark-backup-${stamp}.manifest"
  database_ok=false
  n8n_ok=false

  if pg_dump --format=custom --file="$database_tmp"; then
    mv "$database_tmp" "$database_final"
    database_ok=true
  else
    rm -f "$database_tmp"
    echo "PostgreSQL backup failed at ${stamp}" >&2
  fi

  if tar -C /n8n-data -czf "$n8n_tmp" .; then
    mv "$n8n_tmp" "$n8n_final"
    n8n_ok=true
  else
    rm -f "$n8n_tmp"
    echo "n8n data backup failed at ${stamp}" >&2
  fi

  if [ "$database_ok" = true ] && [ "$n8n_ok" = true ]; then
    {
      printf 'created_at_utc=%s\n' "$stamp"
      printf 'deployed_commit=%s\n' "${MARK_DEPLOYED_COMMIT:?}"
      printf 'n8n_image=docker.n8n.io/n8nio/n8n:%s\n' "${MARK_N8N_VERSION:?}"
      printf 'postgres_image=postgres:%s\n' "${MARK_POSTGRES_VERSION:?}"
      (
        cd /backups
        sha256sum "$(basename "$database_final")" "$(basename "$n8n_final")"
      )
    } >"$manifest_tmp"
    mv "$manifest_tmp" "$manifest_final"
  else
    rm -f "$manifest_tmp"
  fi

  find /backups -type f \
    \( -name 'mark-postgres-*.dump' -o -name 'mark-n8n-data-*.tgz' \
       -o -name 'mark-backup-*.manifest' \) \
    -mtime "+$retention" -delete

  sleep "$interval"
done
