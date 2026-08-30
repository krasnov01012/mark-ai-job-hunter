# MARK container deployment

This package runs the verified MARK workflow on n8n `2.29.10` with PostgreSQL,
bounded execution retention, a loopback-only n8n port, automatic daily backups
and restart policies.

The container does not contain credentials. Keep `.env`, entity exports,
PostgreSQL dumps and n8n data archives outside Git.

Use [docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md) for the migration and cutover
sequence.

## Transactional tag deployment

The repository root now contains `deploy/deploy.sh` and five application
hooks. A deploy is pinned to a strict semantic tag reachable from `main`; the
currently installed revision must also have an exact tag for rollback.

MARK creates a fresh, verified PostgreSQL+n8n backup pair before checkout. The
opaque reference contains the exact pair timestamp. Apply updates only the
non-secret `MARK_DEPLOYED_COMMIT` field in the external root-owned env and
starts the existing Compose package. Health is a bounded local `/healthz`
probe. Rollback validates the referenced manifest and checksums, restores both
PostgreSQL and `n8n_data`, restores the prior commit marker, and only then
starts the old checked-out runtime.

The deployment user invokes the orchestrator without root; sudoers must allow
only the reviewed `deploy/mark/scripts/deploy-*.sh` helpers. The repository
package has local harness coverage, but tags, sudoers and a real server
rollback drill remain server-pilot gates.
