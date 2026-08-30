#!/bin/sh
# Repository-agnostic tag deployment orchestrator.
#
# Application-specific backup, apply, health, rollback and alert behavior is
# provided by executable hooks. See templates/deploy/README.md.

set -eu

say() {
    printf '\n== %s\n' "$1"
}

fail() {
    FAILURE_REASON="$1"
    printf '\nDEPLOY_ERROR: %s\n' "$FAILURE_REASON" >&2
    exit 1
}

cleanup_self() {
    if [ -n "${DEPLOY_SELF_TMP:-}" ]; then
        rm -f "$DEPLOY_SELF_TMP"
    fi
    if [ -n "${BACKUP_OUTPUT_FILE:-}" ]; then
        rm -f "$BACKUP_OUTPUT_FILE"
    fi
}

wait_for_health() {
    attempt=1
    while [ "$attempt" -le "$DEPLOY_HEALTH_ATTEMPTS" ]; do
        if "$DEPLOY_HEALTH_HOOK"; then
            printf 'health check passed on attempt %s/%s\n' \
                "$attempt" "$DEPLOY_HEALTH_ATTEMPTS"
            return 0
        fi

        printf 'health check failed on attempt %s/%s\n' \
            "$attempt" "$DEPLOY_HEALTH_ATTEMPTS" >&2
        if [ "$attempt" -lt "$DEPLOY_HEALTH_ATTEMPTS" ]; then
            sleep "$DEPLOY_HEALTH_INTERVAL_SECONDS"
        fi
        attempt=$((attempt + 1))
    done
    return 1
}

run_rollback() {
    ROLLBACK_RUNNING=1
    rollback_ok=1

    say "rollback to $ROLLBACK_TAG"
    if ! git checkout --detach --force "$ROLLBACK_COMMIT"; then
        printf 'ROLLBACK_ERROR: could not restore Git revision\n' >&2
        rollback_ok=0
    fi

    if [ "$rollback_ok" -eq 1 ]; then
        if [ ! -x "$DEPLOY_ROLLBACK_HOOK" ]; then
            printf 'ROLLBACK_ERROR: rollback hook is unavailable\n' >&2
            rollback_ok=0
        elif ! "$DEPLOY_ROLLBACK_HOOK" "$ROLLBACK_TAG" "$BACKUP_REF"; then
            printf 'ROLLBACK_ERROR: application or data restore failed\n' >&2
            rollback_ok=0
        fi
    fi

    if [ "$rollback_ok" -eq 1 ] && ! wait_for_health; then
        printf 'ROLLBACK_ERROR: restored revision is unhealthy\n' >&2
        rollback_ok=0
    fi

    rollback_result=success
    if [ "$rollback_ok" -ne 1 ]; then
        rollback_result=failed
    fi

    if [ -x "$DEPLOY_ALERT_HOOK" ]; then
        if ! "$DEPLOY_ALERT_HOOK" \
            "$FAILURE_REASON" "$TARGET_TAG" "$ROLLBACK_TAG" "$rollback_result"; then
            printf 'ROLLBACK_ERROR: alert hook failed\n' >&2
            rollback_ok=0
        fi
    else
        printf 'ROLLBACK_ERROR: alert hook is unavailable\n' >&2
        rollback_ok=0
    fi

    ROLLBACK_ARMED=0
    ROLLBACK_RUNNING=0
    [ "$rollback_ok" -eq 1 ]
}

on_exit() {
    status="$1"
    trap - 0 HUP INT TERM

    if [ "$ROLLBACK_ARMED" -eq 1 ] && [ "$ROLLBACK_RUNNING" -eq 0 ]; then
        if ! run_rollback; then
            status=1
        fi
        # A deployment that needed rollback is never reported as successful.
        status=1
    fi

    cleanup_self
    exit "$status"
}

# Run an immutable copy. A checkout may replace deploy/deploy.sh while the
# shell is still reading it; continuing the old and new files mixed together
# is unsafe.
if [ "${DEPLOY_REEXEC:-0}" != "1" ]; then
    deploy_tmp="$(mktemp "${TMPDIR:-/tmp}/deploy-contract.XXXXXX")"
    cp "$0" "$deploy_tmp"
    chmod 700 "$deploy_tmp"
    DEPLOY_REEXEC=1
    DEPLOY_SELF_TMP="$deploy_tmp"
    export DEPLOY_REEXEC DEPLOY_SELF_TMP
    exec sh "$deploy_tmp" "$@"
fi

ROLLBACK_ARMED=0
ROLLBACK_RUNNING=0
FAILURE_REASON="unexpected deployment failure"
TARGET_TAG="${1:-${DEPLOY_TAG:-}}"
ROLLBACK_TAG=""
ROLLBACK_COMMIT=""
BACKUP_REF=""
BACKUP_OUTPUT_FILE=""

trap 'on_exit $?' 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

: "${PROJECT_DIR:?PROJECT_DIR must point to the application checkout}"

DEPLOY_REMOTE="${DEPLOY_REMOTE:-origin}"
DEPLOY_MAIN_BRANCH="${DEPLOY_MAIN_BRANCH:-main}"
DEPLOY_BACKUP_HOOK="${DEPLOY_BACKUP_HOOK:-deploy/hooks/backup.sh}"
DEPLOY_APPLY_HOOK="${DEPLOY_APPLY_HOOK:-deploy/hooks/apply.sh}"
DEPLOY_HEALTH_HOOK="${DEPLOY_HEALTH_HOOK:-deploy/hooks/health.sh}"
DEPLOY_ROLLBACK_HOOK="${DEPLOY_ROLLBACK_HOOK:-deploy/hooks/rollback.sh}"
DEPLOY_ALERT_HOOK="${DEPLOY_ALERT_HOOK:-deploy/hooks/alert.sh}"
DEPLOY_HEALTH_ATTEMPTS="${DEPLOY_HEALTH_ATTEMPTS:-20}"
DEPLOY_HEALTH_INTERVAL_SECONDS="${DEPLOY_HEALTH_INTERVAL_SECONDS:-6}"

case "$DEPLOY_HEALTH_ATTEMPTS" in
    ''|0|*[!0-9]*) fail "DEPLOY_HEALTH_ATTEMPTS must be a positive integer" ;;
esac
case "$DEPLOY_HEALTH_INTERVAL_SECONDS" in
    ''|*[!0-9]*) fail "DEPLOY_HEALTH_INTERVAL_SECONDS must be a non-negative integer" ;;
esac

if [ -z "$TARGET_TAG" ]; then
    fail "usage: deploy/deploy.sh v<MAJOR>.<MINOR>.<PATCH>"
fi
if ! printf '%s\n' "$TARGET_TAG" |
    grep -Eq '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'; then
    fail "target must be a strict semantic tag such as v1.2.3"
fi

cd "$PROJECT_DIR" || fail "PROJECT_DIR is unavailable"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    fail "PROJECT_DIR is not a Git checkout"
fi

for hook in \
    "$DEPLOY_BACKUP_HOOK" \
    "$DEPLOY_APPLY_HOOK" \
    "$DEPLOY_HEALTH_HOOK" \
    "$DEPLOY_ROLLBACK_HOOK" \
    "$DEPLOY_ALERT_HOOK"; do
    if [ ! -x "$hook" ]; then
        fail "required deploy hook is missing or not executable"
    fi
done

say "preflight"
if [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
    fail "working tree is dirty"
fi

if ! git fetch --tags --prune "$DEPLOY_REMOTE" "$DEPLOY_MAIN_BRANCH"; then
    fail "fetch failed"
fi

MAIN_REF="$DEPLOY_REMOTE/$DEPLOY_MAIN_BRANCH"
TARGET_COMMIT="$(git rev-parse --verify "refs/tags/$TARGET_TAG^{commit}" 2>/dev/null || true)"
if [ -z "$TARGET_COMMIT" ]; then
    fail "target tag does not exist"
fi
if ! git merge-base --is-ancestor "$TARGET_COMMIT" "$MAIN_REF"; then
    fail "target tag is not reachable from $MAIN_REF"
fi

CURRENT_COMMIT="$(git rev-parse --verify HEAD)"
if [ "$CURRENT_COMMIT" = "$TARGET_COMMIT" ]; then
    say "idempotent health check"
    if ! wait_for_health; then
        fail "current target revision is unhealthy"
    fi
    say "already deployed"
    printf 'tag=%s commit=%s\n' "$TARGET_TAG" "$TARGET_COMMIT"
    exit 0
fi

ROLLBACK_TAG="$(git describe --tags --exact-match --match 'v[0-9]*' HEAD 2>/dev/null || true)"
if [ -z "$ROLLBACK_TAG" ]; then
    fail "current revision has no exact rollback tag"
fi
if ! printf '%s\n' "$ROLLBACK_TAG" |
    grep -Eq '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'; then
    fail "current rollback tag is not strict semantic versioning"
fi

ROLLBACK_COMMIT="$(git rev-parse --verify "refs/tags/$ROLLBACK_TAG^{commit}" 2>/dev/null || true)"
if [ -z "$ROLLBACK_COMMIT" ] || [ "$ROLLBACK_COMMIT" != "$CURRENT_COMMIT" ]; then
    fail "rollback tag does not identify the current revision"
fi
if ! git merge-base --is-ancestor "$ROLLBACK_COMMIT" "$MAIN_REF"; then
    fail "rollback tag is not reachable from $MAIN_REF"
fi

say "backup"
if ! BACKUP_OUTPUT_FILE="$(mktemp "${TMPDIR:-/tmp}/deploy-backup-output.XXXXXX")"; then
    fail "could not create temporary file for backup hook output"
fi
if ! "$DEPLOY_BACKUP_HOOK" >"$BACKUP_OUTPUT_FILE"; then
    fail "backup hook failed"
fi
if ! BACKUP_LINE_COUNT="$(awk 'END { print NR }' "$BACKUP_OUTPUT_FILE")"; then
    fail "could not validate backup hook output"
fi
if [ "$BACKUP_LINE_COUNT" != "1" ]; then
    fail "backup hook must print exactly one opaque reference on stdout"
fi
if ! BACKUP_REF="$(cat "$BACKUP_OUTPUT_FILE")"; then
    fail "could not read backup hook output"
fi
rm -f "$BACKUP_OUTPUT_FILE"
BACKUP_OUTPUT_FILE=""
if [ -z "$BACKUP_REF" ]; then
    fail "backup hook returned no backup reference"
fi

# A backup hook must not change version-controlled files.
if [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
    fail "backup hook dirtied the working tree"
fi

ROLLBACK_ARMED=1

say "checkout $TARGET_TAG"
if ! git checkout --detach "$TARGET_COMMIT"; then
    FAILURE_REASON="target checkout failed"
    exit 1
fi

say "apply"
if ! "$DEPLOY_APPLY_HOOK" "$TARGET_TAG" "$TARGET_COMMIT"; then
    FAILURE_REASON="apply hook failed"
    exit 1
fi

say "health"
if ! wait_for_health; then
    FAILURE_REASON="target health check failed"
    exit 1
fi

ROLLBACK_ARMED=0
say "deployed"
printf 'tag=%s commit=%s previous_tag=%s\n' \
    "$TARGET_TAG" "$TARGET_COMMIT" "$ROLLBACK_TAG"
