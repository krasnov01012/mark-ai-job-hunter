const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const workflowPath = path.join(root, 'n8n', 'workflows', 'ai-job-hunter-main.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const nodes = new Map(workflow.nodes.map((node) => [node.name, node]));
let checks = 0;

function assert(condition, message) {
  checks += 1;
  if (!condition) throw new Error(message);
}

function targets(name) {
  return (workflow.connections[name]?.main ?? [])
    .flat()
    .filter(Boolean)
    .map((connection) => connection.node);
}

function code(fileName) {
  return fs.readFileSync(path.join(root, 'n8n', 'code', fileName), 'utf8');
}

assert(workflow.id === 'RO4i4YmNzEzC2TEV', 'Stable workflow ID must be preserved');
assert(workflow.active === false, 'Workflow must stay inactive until live verification');
assert(Object.keys(workflow.pinData ?? {}).length === 0, 'Stable workflow must not contain pinned data');
assert(nodes.has('Schedule Trigger — Every 10 Minutes'), 'Ten-minute schedule trigger is missing');
assert(nodes.has('Initialize Run Metrics'), 'Run initializer is missing');
assert(!nodes.has('Scheduler Gate — 30m + One 5m Retry'), 'Legacy scheduler gate must be removed');
assert(!nodes.has('When clicking ‘Execute workflow’'), 'Manual trigger must be removed from final schedule workflow');
assert(!nodes.has('Dev Limit'), 'Development limit must be removed');
assert(!nodes.has('Edit Fields'), 'Legacy smoke node must be removed');
assert(!nodes.has('Send a text message'), 'Legacy Telegram node must be removed');
assert(!nodes.has('HTTP Request'), 'Legacy HH node must be removed');
assert(!nodes.has('NVIDIA API — Primary'), 'Connectivity test node must be removed');
assert(!nodes.has('NVIDIA Connectivity Test — Secondary'), 'Secondary connectivity node must be removed');

for (const name of ['Hard Filter — Full Vacancy', 'Level Filter Seniority', 'Candidate Profile']) {
  assert(nodes.get(name)?.parameters?.mode === 'runOnceForEachItem', `${name} must process every item`);
}
assert(
  (nodes.get('Habr RSS Pre-filter')?.parameters?.mode ?? 'runOnceForAllItems') === 'runOnceForAllItems',
  'RSS pre-filter must process and sort the full batch',
);
const scheduleInterval = nodes.get('Schedule Trigger — Every 10 Minutes')?.parameters?.rule?.interval?.[0];
assert(scheduleInterval?.field === 'minutes', 'Schedule trigger must use a minute interval');
assert(scheduleInterval.minutesInterval === 10, 'Schedule trigger must run every ten minutes');

const requiredPath = [
  ['Schedule Trigger — Every 10 Minutes', 'Initialize Run Metrics'],
  ['Initialize Run Metrics', 'Habr RSS Collector'],
  ['Initialize Run Metrics', 'Build HH Search Requests'],
  ['Build HH Search Requests', 'HH Search Vacancies'],
  ['HH Search Vacancies', 'Parse HH Search Results'],
  ['Parse HH Search Results', 'Run Metrics — HH Search Items'],
  ['Run Metrics — HH Search Items', 'HH Durable Source Gate — New + Due'],
  ['HH Durable Source Gate — New + Due', 'HH Search Result Pre-filter'],
  ['HH Search Result Pre-filter', 'Keep HH PASS + REVIEW'],
  ['Keep HH PASS + REVIEW', 'Fetch HH Vacancy Details'],
  ['Fetch HH Vacancy Details', 'Normalize HH Vacancy'],
  ['Normalize HH Vacancy', 'Hard Filter — Full Vacancy'],
  ['Habr RSS Collector', 'Run Metrics — RSS Items'],
  ['Run Metrics — RSS Items', 'Habr RSS — Unique GUIDs'],
  ['Habr RSS — Unique GUIDs', 'Durable Source Gate — New + Due'],
  ['Durable Source Gate — New + Due', 'Habr RSS Pre-filter'],
  ['Habr RSS Pre-filter', 'Keep PASS + REVIEW'],
  ['Keep PASS + REVIEW', 'Run Metrics — Pre-filter PASS'],
  ['Run Metrics — Pre-filter PASS', 'Fetch Habr Vacancy Page'],
  ['Fetch Habr Vacancy Page', 'Normalize Habr Vacancy'],
  ['Normalize Habr Vacancy', 'Hard Filter — Full Vacancy'],
  ['Hard Filter — Full Vacancy', 'Persist Source Processing Result'],
  ['Persist Source Processing Result', 'Keep Hard Filter PASS'],
  ['Keep Hard Filter PASS', 'Run Metrics — Hard PASS'],
  ['Run Metrics — Hard PASS', 'Level Filter Seniority'],
  ['Level Filter Seniority', 'Keep Level PASS + STRETCH'],
  ['Keep Level PASS + STRETCH', 'Run Metrics — Level PASS + STRETCH'],
  ['Run Metrics — Level PASS + STRETCH', 'Candidate Profile'],
  ['Candidate Profile', 'Durable Vacancy State Gate'],
  ['Needs NVIDIA Score', 'NVIDIA Rate Budget — Max 10 Vacancies'],
  ['NVIDIA Rate Budget — Max 10 Vacancies', 'Build NVIDIA Scoring Request'],
  ['Parse NVIDIA Result — Nano Primary', 'Nano Primary Needs Credential Failover'],
  ['Nano Primary Needs Credential Failover', 'NVIDIA Scorer — Nano Secondary'],
  ['Build Telegram Vacancy Card', 'Send MARK Vacancy Card'],
  ['Send MARK Vacancy Card', 'Persist Telegram Delivery Result'],
];
for (const [from, to] of requiredPath) {
  assert(targets(from).includes(to), `Missing connection: ${from} -> ${to}`);
}

assert(targets('Durable Vacancy State Gate').includes('Needs NVIDIA Score'), 'Durable state must route new scores');
assert(targets('Durable Vacancy State Gate').includes('Needs Telegram Retry'), 'Durable state must route pending delivery');
assert(targets('Keep PASS + REVIEW').includes('Persist Source Processing Result'), 'Pre-filter rejects must be finalized in source state');
assert(targets('Keep HH PASS + REVIEW').includes('Persist Source Processing Result'), 'HH pre-filter rejects must be finalized in source state');
assert(targets('Build NVIDIA Scoring Request').includes('Route NVIDIA Primary'), 'Request must branch to primary');
assert(targets('Build NVIDIA Scoring Request').includes('Route NVIDIA Secondary'), 'Request must honor an open primary circuit');
assert(targets('Parse NVIDIA Result — Primary').includes('Primary Needs Credential Failover'), 'Primary result must support credential failover');
assert(targets('Parse NVIDIA Result — Primary').includes('Primary Needs Model Fallback'), 'Primary result must support model fallback');
assert(targets('Parse NVIDIA Result — Secondary').includes('Secondary Needs Model Fallback'), 'Secondary result must support model fallback');

const rateBudget = nodes.get('NVIDIA Rate Budget — Max 10 Vacancies');
assert(rateBudget.type === 'n8n-nodes-base.code', 'Multi-source NVIDIA budget must be global per run');

for (const name of ['HH Search Vacancies', 'Fetch HH Vacancy Details']) {
  const node = nodes.get(name);
  assert(node?.credentials?.oAuth2Api?.id, `${name} must reference an n8n OAuth2 credential`);
  assert(!node.credentials.oAuth2Api.id.startsWith('configure-'), `${name} must not use a placeholder credential`);
  assert(node.parameters.genericAuthType === 'oAuth2Api', `${name} must use OAuth2`);
  assert(node.parameters.headerParameters.parameters.some((header) => header.name === 'HH-User-Agent'), `${name} must send HH-User-Agent`);
  assert(node.parameters.options.response.response.fullResponse === true, `${name} must expose status`);
  assert(node.parameters.options.response.response.neverError === true, `${name} must preserve HH error bodies`);
  assert(node.retryOnFail === true && node.maxTries === 2, `${name} must use bounded retry`);
}

for (const name of [
  'NVIDIA Scorer — Primary',
  'NVIDIA Scorer — Secondary',
  'NVIDIA Scorer — Nano Primary',
  'NVIDIA Scorer — Nano Secondary',
]) {
  const node = nodes.get(name);
  assert(node?.credentials?.httpHeaderAuth?.id, `${name} must reference an n8n credential`);
  assert(node.parameters.options.response.response.fullResponse === true, `${name} must include status and headers`);
  assert(node.parameters.options.response.response.neverError === true, `${name} must classify HTTP status in workflow`);
  assert(node.parameters.options.timeout === 120000, `${name} must have a bounded timeout`);
  assert(node.retryOnFail === false, `${name} must not hide attempts in built-in retry`);
}

const telegram = nodes.get('Send MARK Vacancy Card');
assert(telegram?.credentials?.telegramApi?.id, 'Telegram node must reference an n8n credential');
assert(telegram.parameters.chatId === '={{ $env.MARK_TELEGRAM_CHAT_ID }}', 'Telegram Chat ID must come from environment');
assert(telegram.parameters.additionalFields.parse_mode === 'HTML', 'Telegram card must use HTML parse mode');
assert(telegram.retryOnFail === true && telegram.maxTries === 2, 'Telegram retry must be bounded');

const codeMap = {
  'Habr RSS Pre-filter': 'habr-rss-prefilter.js',
  'Normalize Habr Vacancy': 'habr-vacancy-normalizer.js',
  'Hard Filter — Full Vacancy': 'habr-hard-filter.js',
  'Level Filter Seniority': 'habr-level-filter.js',
  'Candidate Profile': 'candidate-profile.js',
  'Initialize Run Metrics': 'initialize-run.js',
  'Durable Source Gate — New + Due': 'durable-source-gate.js',
  'Persist Source Processing Result': 'durable-source-result.js',
  'Build HH Search Requests': 'hh-search-requests.js',
  'Parse HH Search Results': 'hh-search-response.js',
  'Run Metrics — HH Search Items': 'update-run-metrics.js',
  'HH Durable Source Gate — New + Due': 'durable-source-gate.js',
  'HH Search Result Pre-filter': 'hh-search-prefilter.js',
  'Normalize HH Vacancy': 'hh-vacancy-normalizer.js',
  'Run Metrics — RSS Items': 'update-run-metrics.js',
  'Run Metrics — Pre-filter PASS': 'update-run-metrics.js',
  'Run Metrics — Hard PASS': 'update-run-metrics.js',
  'Run Metrics — Level PASS + STRETCH': 'update-run-metrics.js',
  'Durable Vacancy State Gate': 'durable-state-gate.js',
  'NVIDIA Rate Budget — Max 10 Vacancies': 'nvidia-rate-budget.js',
  'Build NVIDIA Scoring Request': 'nvidia-scoring-request.js',
  'Parse NVIDIA Result — Primary': 'nvidia-scoring-response.js',
  'Parse NVIDIA Result — Secondary': 'nvidia-scoring-response.js',
  'Parse NVIDIA Result — Nano Primary': 'nvidia-scoring-response.js',
  'Parse NVIDIA Result — Nano Secondary': 'nvidia-scoring-response.js',
  'Build Telegram Vacancy Card': 'telegram-vacancy-card.js',
  'Persist Telegram Delivery Result': 'mark-delivery-result.js',
};
for (const [nodeName, fileName] of Object.entries(codeMap)) {
  assert(nodes.get(nodeName)?.parameters?.jsCode === code(fileName), `${nodeName} must match ${fileName}`);
}

const nodeNames = new Set(nodes.keys());
for (const [from, outputs] of Object.entries(workflow.connections)) {
  assert(nodeNames.has(from), `Connection root does not exist: ${from}`);
  for (const output of outputs.main ?? []) {
    for (const connection of output ?? []) {
      assert(nodeNames.has(connection.node), `Connection target does not exist: ${connection.node}`);
    }
  }
}

const reachable = new Set();
const queue = ['Schedule Trigger — Every 10 Minutes'];
while (queue.length > 0) {
  const current = queue.shift();
  if (reachable.has(current)) continue;
  reachable.add(current);
  queue.push(...targets(current));
}
assert(reachable.size === nodes.size, `All nodes must be reachable from schedule (${reachable.size}/${nodes.size})`);

const serialized = JSON.stringify(workflow);
assert(workflow.staticData === null, 'Public workflow export must not contain production static state');
assert(!/(?:nvapi-|sk-|gh[pousr]_)[A-Za-z0-9_-]{12,}/.test(serialized), 'Workflow must not contain obvious secrets');
assert(!/Bearer\s+[A-Za-z0-9._-]{12,}/i.test(serialized), 'Workflow must not contain a literal Bearer token');
assert(!/clientId|client_id/i.test(serialized), 'Workflow must not contain an OAuth client ID field');
assert(!/"name":"Authorization","value":"(?:Bearer\s+)?[A-Za-z0-9._-]{12,}"/i.test(serialized), 'Workflow must not contain a literal Authorization header');
assert(!/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(serialized), 'Workflow must not contain email addresses');
assert(!/"chatId":"\d{6,}"/.test(serialized), 'Workflow must not contain a literal Chat ID');
assert(!/[A-Z]:\\Users\\/.test(serialized), 'Workflow must not contain local user paths');
assert(!/clientSecret|client_secret|access_token|refresh_token/i.test(serialized), 'Workflow must not contain OAuth token material');

console.log(`PASS: ${checks} workflow-structure checks (${nodes.size} nodes)`);
