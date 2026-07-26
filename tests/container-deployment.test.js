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
check(
  compose.includes('${MARK_BACKUP_DIR:?MARK_BACKUP_DIR is required}:/backups'),
  'backups must use the external Main Server path',
);
check(
  compose.includes('${MARK_MIGRATION_DIR:?MARK_MIGRATION_DIR is required}:/opt/mark/migration:ro'),
  'migration staging must use the external Main Server path',
);
check(!compose.includes('./runtime/'), 'Compose must not store runtime data in the repository');
check(!compose.includes('0.0.0.0:'), 'Compose must not publish wildcard ports');
check(!compose.includes('network_mode: host'), 'services must not use the host network');
check(!compose.includes('/var/run/docker.sock'), 'services must not receive the Docker socket');
check(!compose.includes('user: "996'), 'official images must not be forced to the host mark UID');
check(
  (compose.match(/cap_drop:\n\s+- ALL/g) || []).length >= 2,
  'n8n and backup services must drop all Linux capabilities',
);
check(
  (compose.match(/cap_add:\n\s+- DAC_READ_SEARCH/g) || []).length === 1,
  'backup must add only read/search bypass for node-owned n8n data',
);

check(envExample.includes('N8N_VERSION=2.29.10'), 'env template must pin n8n');
check(envExample.includes('N8N_ENCRYPTION_KEY=CHANGE_ME_'), 'env template must not contain a real encryption key');
check(envExample.includes('POSTGRES_PASSWORD=CHANGE_ME_'), 'env template must not contain a real database password');
check(envExample.includes('MARK_TELEGRAM_CHAT_ID=CHANGE_ME_'), 'env template must not contain a real Chat ID');
check(envExample.includes('MIGRATION_REQUIRED=true'), 'existing MARK state migration must be required by default');
check(
  envExample.includes('MARK_MIGRATION_DIR=/var/lib/mark/migration'),
  'env template must use the external migration path',
);
check(
  envExample.includes('MARK_BACKUP_DIR=/var/lib/mark/backups'),
  'env template must use the external backup path',
);
check(
  envExample.includes('MARK_DEPLOYED_COMMIT=CHANGE_ME_'),
  'backup manifests must receive the deployed commit',
);

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
  'common.sh',
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
  restoreScript.includes('-v "$entities_dir:/opt/mark/import"'),
  'ephemeral entity importer must receive a writable entities-only mount',
);
check(
  restoreScript.includes('import:entities --inputDir=/opt/mark/import --truncateTables true'),
  'restore must import the external archive into a clean target database',
);
check(
  restoreScript.includes('unpublish:workflow --all'),
  'restore must unpublish every workflow before n8n starts',
);

const commonScript = read('deploy/mark/scripts/common.sh');
check(
  commonScript.includes('MARK_ENV_FILE:-/etc/mark/mark.env'),
  'scripts must default to the external root-owned environment file',
);
check(
  commonScript.includes('docker compose --env-file "$env_file"'),
  'every Compose operation must use the explicit external env file',
);

const checkEnvScript = read('deploy/mark/scripts/check-env.sh');
check(
  checkEnvScript.includes('must stay outside the deployment tree'),
  'environment validation must reject a secret env inside the checkout',
);
check(
  checkEnvScript.includes('MARK environment file must be owned by root'),
  'target env must be root-owned',
);
check(
  checkEnvScript.includes('MARK_DEPLOYED_COMMIT must be a full Git commit SHA'),
  'environment validation must bind backups to an exact commit',
);

const prepareScript = read('deploy/mark/scripts/prepare-runtime.sh');
check(
  prepareScript.includes('/var/lib/mark/migration') &&
    prepareScript.includes('/var/lib/mark/backups') &&
    prepareScript.includes('/etc/mark'),
  'runtime preparation must create only the external Main Server paths',
);
check(!prepareScript.includes('runtime/backups'), 'runtime preparation must not create repository data paths');
check(!prepareScript.includes('cp .env.example .env'), 'runtime preparation must not create a secret env in the checkout');

const verifyScript = read('deploy/mark/scripts/verify.sh');
check(
  verifyScript.includes('https://api.hh.ru/areas'),
  'HH egress must use a stable API request rather than the redirecting root',
);
check(
  verifyScript.includes("'HH-User-Agent': 'MARK/1.0"),
  'HH egress must send the official HH-User-Agent header',
);
check(
  verifyScript.includes("if (workflow.active !== false)"),
  'pre-publication verification must reject an active workflow',
);

for (const script of [
  'publish-main.sh',
  'restore-entities.sh',
  'start.sh',
  'verify.sh',
]) {
  const contents = read(`deploy/mark/scripts/${script}`);
  check(contents.includes('scripts/common.sh'), `${script} must use the shared external-env wrapper`);
  check(!contents.includes('. ./.env'), `${script} must not source an env file from the checkout`);
  check(!contents.includes('docker compose '), `${script} must not bypass the explicit compose wrapper`);
}

check(!fs.existsSync(path.join(deploymentRoot, '.env')), 'secret .env must not exist in the deployment tree');

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
