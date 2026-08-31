#!/bin/sh
set -eu

project_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/mark-deploy-hooks.XXXXXX")"
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT HUP INT TERM

for script in \
    "$project_dir/deploy/deploy.sh" \
    "$project_dir"/deploy/hooks/*.sh \
    "$project_dir"/deploy/mark/scripts/deploy-*.sh; do
    sh -n "$script"
done

mkdir -p "$tmp/bin"
cat >"$tmp/bin/curl" <<'EOF'
#!/bin/sh
exit "${MOCK_CURL_STATUS:-0}"
EOF
cat >"$tmp/bin/sudo" <<'EOF'
#!/bin/sh
shift # -n
case "${MOCK_SUDO_OUTPUT:-}" in
  '') exit "${MOCK_SUDO_STATUS:-0}" ;;
  *) printf '%s\n' "$MOCK_SUDO_OUTPUT"; exit "${MOCK_SUDO_STATUS:-0}" ;;
esac
EOF
cat >"$tmp/bin/logger" <<'EOF'
#!/bin/sh
exit 0
EOF
chmod +x "$tmp/bin/curl" "$tmp/bin/sudo" "$tmp/bin/logger"

PATH="$tmp/bin:$PATH" MARK_BIND_PORT=5678 \
    "$project_dir/deploy/hooks/health.sh"
if PATH="$tmp/bin:$PATH" MARK_BIND_PORT=invalid \
    "$project_dir/deploy/hooks/health.sh" 2>/dev/null; then
    echo "health hook accepted an invalid port" >&2
    exit 1
fi

if PROJECT_DIR="$project_dir" PATH="$tmp/bin:$PATH" MOCK_SUDO_OUTPUT=bad \
    "$project_dir/deploy/hooks/backup.sh" >/dev/null 2>&1; then
    echo "backup hook accepted an invalid reference" >&2
    exit 1
fi
PROJECT_DIR="$project_dir" PATH="$tmp/bin:$PATH" \
    MOCK_SUDO_OUTPUT=mark:20260830T120000Z \
    "$project_dir/deploy/hooks/backup.sh" | grep -Fx 'mark:20260830T120000Z' >/dev/null

if PROJECT_DIR="$project_dir" PATH="$tmp/bin:$PATH" \
    "$project_dir/deploy/hooks/rollback.sh" v1.0.0 mark:bad >/dev/null 2>&1; then
    echo "rollback hook accepted an invalid reference" >&2
    exit 1
fi

rollback_helper="$project_dir/deploy/mark/scripts/deploy-rollback.sh"
for capability in CHOWN DAC_OVERRIDE FOWNER; do
    grep -F -- "--cap-add $capability" "$rollback_helper" >/dev/null || {
        echo "rollback helper does not restore required $capability capability" >&2
        exit 1
    }
done
grep -F -- "</dev/null >/dev/null" "$rollback_helper" >/dev/null || {
    echo "rollback helper may consume the caller script stdin" >&2
    exit 1
}

PATH="$tmp/bin:$PATH" "$project_dir/deploy/hooks/alert.sh" \
    test v1.1.0 v1.0.0 success
echo "MARK_DEPLOY_HOOK_TESTS=passed"
