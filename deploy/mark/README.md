# MARK container deployment

This package runs the verified MARK workflow on n8n `2.29.10` with PostgreSQL,
bounded execution retention, a loopback-only n8n port, automatic daily backups
and restart policies.

The container does not contain credentials. Keep `.env`, entity exports,
PostgreSQL dumps and n8n data archives outside Git.

Use [docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md) for the migration and cutover
sequence.
