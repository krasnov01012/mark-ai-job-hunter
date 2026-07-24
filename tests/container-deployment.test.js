const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const deploymentRoot = path.join(root, 'deploy', 'mark');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function walk(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walk(absolute));
    else result.push(absolute);
  }
  return result;
}

let checks = 0;
function check(condition, message) {
  assert(condition, message);
  checks += 1;
}

const compose = read('deploy/mark/compose.yaml');
const envExample = read('deploy/mark/.env.example');
const gitignore = read('.gitignore');
const dockerignore = read('.dockerignore');
const gitattributes = read('.gitattributes');
const ci = read('.github/workflows/ci.yml');

check(fs.existsSync(path.join(deploymentRoot, 'compose.yaml')), 'compose.yaml must exist');
check(compose.includes('name: mark'), 'Compose project must use a stable MARK name');
check(compose.includes('docker.n8n.io/n8nio/n8n:${N8N_VERSION:-2.29.10}'), 'n8n must use the verified pinned default');
check(compose.includes('postgres:${POSTGRES_VERSION:-16-alpine}'), 'PostgreSQL major version must be pinned');
check(compose.includes('127.0.0.1:${MARK_BIND_PORT:-5678}:5678'), 'n8n port must bind only to loopback');
check(compose.includes('DB_TYPE: postgresdb'), 'n8n must use PostgreSQL');
check(compose.includes('postgres_data:/var/lib/postgresql/data'), 'PostgreSQL data must be persistent');
check(compose.includes('n8n_data:/home/node/.n8n'), 'n8n user data must be persistent');
check(compose.includes('restart: unless-stopped'), 'services must restart autonomously');
check(compose.includes('condition: service_healthy'), 'n8n must wait for PostgreSQL health');
check(compose.includes("fetch('http://127.0.0.1:5678/healthz')"), 'n8n must have a real health check');
check(compose.includes('N8N_ENCRYPTION_KEY: ${N8N_ENCRYPTION_KEY:'), 'encryption key must come from deployment environment');
check(compose.includes('MARK_TELEGRAM_CHAT_ID: ${MARK_TELEGRAM_CHAT_ID:'), 'Telegram Chat ID must come from deployment environment');
check(compose.includes('N8N_CONCURRENCY_PRODUCTION_LIMIT: "1"'), 'production concurrency must remain one');
check(compose.includes('GENERIC_TIMEZONE: ${GENERIC_TIMEZONE:-Europe/Moscow}'), 'MARK timezone must remain Europe/Moscow');
check(compose.includes('N8N_BLOCK_ENV_ACCESS_IN_NODE: "false"'), 'trusted MARK expressions must retain environment access');
check(compose.includes('N8N_BLOCK_FILE_ACCESS_TO_N8N_FILES: "true"'), 'n8n data files must be blocked from nodes');
check(compose.includes('N8N_COMMUNITY_PACKAGES_ENABLED: "false"'), 'community packages must be disabled');
check(compose.includes('backend:\n    internal: true'), 'database network must be internal');
check(compose.includes('backup:'), 'automatic backup service must exist');
check(compose.includes('./runtime/backups:/backups'), 'backups must be stored outside container layers');

check(envExample.includes('N8N_VERSION=2.29.10'), 'env template must pin n8n');
check(envExample.includes('N8N_ENCRYPTION_KEY=CHANGE_ME_'), 'env template must not contain a real encryption key');
check(envExample.includes('POSTGRES_PASSWORD=CHANGE_ME_'), 'env template must not contain a real database password');
check(envExample.includes('MARK_TELEGRAM_CHAT_ID=CHANGE_ME_'), 'env template must not contain a real Chat ID');
check(envExample.includes('MIGRATION_REQUIRED=true'), 'existing MARK state migration must be required by default');

check(gitignore.includes('deploy/mark/.env'), 'deployment .env must be ignored');
check(gitignore.includes('deploy/mark/runtime/'), 'deployment runtime must be ignored');
check(dockerignore.includes('**/.env.*'), 'Docker context must exclude environment files');
check(dockerignore.includes('deploy/mark/runtime'), 'Docker context must exclude runtime data');
check(gitattributes.includes('*.sh text eol=lf'), 'deployment scripts must keep LF line endings');

check(ci.includes('Regression tests'), 'CI must run regression tests');
check(ci.includes('docker compose'), 'CI must validate Compose');

const requiredScripts = [
  'backup-loop.sh',
  'check-env.sh',
  'prepare-runtime.sh',
  'publish-main.sh',
  'restore-entities.sh',
  'start.sh',
  'verify.sh',
];
for (const script of requiredScripts) {
  const absolute = path.join(deploymentRoot, 'scripts', script);
  check(fs.existsSync(absolute), `${script} must exist`);
  check(read(path.relative(root, absolute)).startsWith('#!/bin/sh\nset -eu\n'), `${script} must be strict POSIX shell`);
}

const restoreScript = read('deploy/mark/scripts/restore-entities.sh');
check(
  restoreScript.includes('-v "$entities_dir:/opt/mark/migration/entities"'),
  'ephemeral entity importer must receive a writable entities-only mount',
);

const protectedFiles = [
  ...walk(path.join(root, 'config')),
  ...walk(path.join(root, 'deploy')),
  ...walk(path.join(root, 'docs')),
  ...walk(path.join(root, 'n8n')),
  path.join(root, 'README.md'),
].filter((file) => !file.includes(`${path.sep}runtime${path.sep}`));

const secretPatterns = [
  { name: 'NVIDIA API key', pattern: /\bnvapi-[A-Za-z0-9_-]{16,}\b/g },
  { name: 'Telegram bot token', pattern: /\b\d{6,}:[A-Za-z0-9_-]{25,}\b/g },
  { name: 'long uppercase OAuth material', pattern: /\b[A-Z0-9]{56,}\b/g },
  { name: 'private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
];

for (const file of protectedFiles) {
  const contents = fs.readFileSync(file, 'utf8');
  for (const { name, pattern } of secretPatterns) {
    pattern.lastIndex = 0;
    check(!pattern.test(contents), `${name} must not appear in ${path.relative(root, file)}`);
  }
}

console.log(`PASS: ${checks} container-deployment checks`);
