#!/bin/sh
set -eu

reason="${1:-unspecified}"
target_tag="${2:-unknown}"
rollback_tag="${3:-unknown}"
rollback_result="${4:-unknown}"
message="reason=$reason target=$target_tag rollback=$rollback_tag result=$rollback_result"

if [ -n "${DEPLOY_ALERT_COMMAND:-}" ]; then
    [ -x "$DEPLOY_ALERT_COMMAND" ] || {
        echo "DEPLOY_ALERT_COMMAND is not executable" >&2
        exit 1
    }
    "$DEPLOY_ALERT_COMMAND" mark "$reason" "$target_tag" "$rollback_tag" "$rollback_result"
else
    logger -t mark-deploy -- "$message"
fi
