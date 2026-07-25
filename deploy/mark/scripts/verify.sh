#!/bin/sh
set -eu

deploy_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$deploy_dir"

# shellcheck disable=SC1091
. "$deploy_dir/scripts/common.sh"
require_environment

compose ps

compose exec -T n8n node - <<'NODE'
const checks = [
  ['health', 'http://127.0.0.1:5678/healthz', [200], {}],
  ['telegram-egress', 'https://api.telegram.org/', [200, 302], {}],
  ['nvidia-egress', 'https://integrate.api.nvidia.com/v1/models', [200, 401, 403], {}],
  [
    'hh-egress',
    'https://api.hh.ru/areas',
    [200],
    { 'HH-User-Agent': 'MARK/1.0 (AI Job Hunter; owner contact in HH developer profile)' },
  ],
];

let failed = false;
for (const [name, url, accepted, headers] of checks) {
  try {
    const response = await fetch(url, {
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    const ok = accepted.includes(response.status);
    console.log(`${name}=${response.status}${ok ? '' : ':unexpected'}`);
    failed ||= !ok;
  } catch (error) {
    console.log(`${name}=unreachable`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
NODE

workflow_tmp="/tmp/mark-workflow-verify.json"
compose exec -T -u node n8n n8n export:workflow \
  --id=RO4i4YmNzEzC2TEV --output="$workflow_tmp" >/dev/null

compose exec -T n8n node - "$workflow_tmp" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const workflow = Array.isArray(raw) ? raw[0] : raw;
const pins = Object.keys(workflow.pinData || {});
if (workflow.id !== 'RO4i4YmNzEzC2TEV') throw new Error('Unexpected workflow ID');
if (!Array.isArray(workflow.nodes) || workflow.nodes.length !== 54) throw new Error('Expected 54 nodes');
if (pins.length !== 0) throw new Error('pinData must be empty');
if (workflow.active !== false) throw new Error('Workflow must remain unpublished');
console.log(`workflow=${workflow.id};nodes=${workflow.nodes.length};active=false;pinData=0`);
NODE

compose exec -T -u node n8n rm -f "$workflow_tmp"
echo "MARK container verification passed without invoking provider credentials or Telegram delivery."
