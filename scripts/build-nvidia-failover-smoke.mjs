import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const mainPath = path.join(root, 'n8n', 'workflows', 'ai-job-hunter-main.json');
const outputPath = path.join(root, '.codex-nvidia-failover-smoke.json');
const main = JSON.parse(fs.readFileSync(mainPath, 'utf8'));
const mainNodes = new Map(main.nodes.map((node) => [node.name, node]));
const workflowId = `JH12${Date.now().toString(36)}`;

function clone(name) {
  const node = mainNodes.get(name);
  if (!node) throw new Error(`Main workflow node missing: ${name}`);
  return structuredClone(node);
}

const manual = {
  parameters: {},
  type: 'n8n-nodes-base.manualTrigger',
  typeVersion: 1,
  position: [0, 0],
  id: 'f035a9d2-aea3-408a-b08f-63da08888201',
  name: 'When clicking ‘Execute workflow’',
};

const buildCases = {
  parameters: {
    jsCode: `const scenarios = ['401', '429', 'timeout', '503'];
return scenarios.map((scenario) => ({
  json: {
    scenario,
    fixture_url: \`http://127.0.0.1:5676/\${scenario}\`,
    vacancy_key: \`smoke:nvidia-\${scenario}\`,
    source: 'controlled_smoke',
    source_id: scenario,
    title: 'Junior AI Automation Engineer',
    company: 'Controlled Fixture',
    url: 'https://example.invalid/controlled-smoke',
    work_format: 'remote',
    location: 'Georgia',
    skills: ['JavaScript', 'n8n', 'LLM API'],
    description: 'Build and test reliable LLM API integrations and automation workflows.',
    level_decision: 'PASS',
    level_filter_reasons: ['Junior role'],
    hard_filter_reasons: ['Remote allowed'],
    vacancy_state_action: 'score',
    should_continue_to_nvidia_scorer: true,
    candidate_profile_version: '1.1.0',
    candidate_profile_for_scorer: {
      schema: 'mark.candidate_for_scorer.v1',
      profile_version: '1.1.0',
      skills: [{ name: 'JavaScript', level: 'project_applied' }],
      gaps: [{ name: 'Commercial production experience', level: 'not_proven' }],
      truth: { commercial_ai_experience: false },
    },
  },
}));`,
  },
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [208, 0],
  id: '6d1ac9a8-e2a3-4081-8398-eabccbc12ec7',
  name: 'Build Controlled Failover Cases',
};

const buildRequest = clone('Build NVIDIA Scoring Request');
buildRequest.position = [416, 0];

const primary = clone('NVIDIA Scorer — Primary');
primary.position = [624, 0];
primary.parameters.url = '={{ $json.fixture_url }}';
delete primary.parameters.authentication;
delete primary.parameters.genericAuthType;
delete primary.credentials;
primary.parameters.options.timeout = 400;

const parsePrimary = clone('Parse NVIDIA Result — Primary');
parsePrimary.position = [832, 0];

const failover = clone('Primary Needs Credential Failover');
failover.position = [1040, 0];

const secondary = clone('NVIDIA Scorer — Secondary');
secondary.position = [1248, 0];

const parseSecondary = clone('Parse NVIDIA Result — Secondary');
parseSecondary.position = [1456, 0];

const secondaryValid = clone('Secondary Score Needs Delivery');
secondaryValid.id = '0fbc0c17-690e-4dcc-9620-a4bd628868ea';
secondaryValid.name = 'Secondary Result Valid';
secondaryValid.position = [1664, -112];
secondaryValid.parameters.conditions.conditions[0].leftValue = '={{ $json.nvidia_result_valid }}';

const secondaryModelFallback = clone('Secondary Needs Model Fallback');
secondaryModelFallback.position = [1664, 112];

const nanoSecondary = clone('NVIDIA Scorer — Nano Secondary');
nanoSecondary.position = [1872, 112];

const parseNanoSecondary = clone('Parse NVIDIA Result — Nano Secondary');
parseNanoSecondary.position = [2080, 112];

const validate = {
  parameters: {
    mode: 'runOnceForEachItem',
    jsCode: `const expected = {
  '401': 'authentication_error',
  '429': 'rate_limit',
  timeout: 'request_timeout',
  '503': 'provider_transient',
};
const row = $input.item.json;
const failures = [];
const prefix = row.scenario ?? 'unknown';
if (row.nvidia_result_valid !== true) failures.push(\`\${prefix}: final result invalid\`);
if (row.nvidia_credential_alias !== 'nvidia_secondary') failures.push(\`\${prefix}: secondary alias missing\`);
if (![2, 3].includes(row.nvidia_attempt_count)) failures.push(\`\${prefix}: expected 2 or 3 attempts\`);
if (row.nvidia_fallback_used !== true) failures.push(\`\${prefix}: fallback flag missing\`);
if (row.nvidia_fallback_reason !== expected[prefix]) failures.push(\`\${prefix}: unexpected reason \${row.nvidia_fallback_reason}\`);
if (!row.nvidia_used_credential_aliases?.includes('nvidia_primary') || !row.nvidia_used_credential_aliases?.includes('nvidia_secondary')) {
  failures.push(\`\${prefix}: credential chain incomplete\`);
}
if (failures.length) throw new Error(\`Controlled NVIDIA failover failed: \${failures.join('; ')}\`);
return { json: {
  status: 'PASS',
  checks: 6,
  scenario: row.scenario,
  fallback_reason: row.nvidia_fallback_reason,
  fallback_reasons: row.nvidia_fallback_reasons,
  attempt_count: row.nvidia_attempt_count,
  final_credential_alias: row.nvidia_credential_alias,
  final_model_id: row.nvidia_model_id,
} };`,
  },
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [2288, 0],
  id: 'acfeb643-800b-4d9c-8320-1cbdb88ec4f9',
  name: 'Validate Controlled Failover',
};

const ordered = [
  manual,
  buildCases,
  buildRequest,
  primary,
  parsePrimary,
  failover,
  secondary,
  parseSecondary,
  secondaryValid,
  secondaryModelFallback,
  nanoSecondary,
  parseNanoSecondary,
  validate,
];
const connections = {};
function connect(from, ...targets) {
  connections[from] = { main: [targets.map((node) => ({ node, type: 'main', index: 0 }))] };
}
connect(manual.name, buildCases.name);
connect(buildCases.name, buildRequest.name);
connect(buildRequest.name, primary.name);
connect(primary.name, parsePrimary.name);
connect(parsePrimary.name, failover.name);
connect(failover.name, secondary.name);
connect(secondary.name, parseSecondary.name);
connect(parseSecondary.name, secondaryValid.name, secondaryModelFallback.name);
connect(secondaryValid.name, validate.name);
connect(secondaryModelFallback.name, nanoSecondary.name);
connect(nanoSecondary.name, parseNanoSecondary.name);
connect(parseNanoSecondary.name, validate.name);

const workflow = {
  id: workflowId,
  name: `MARK NVIDIA Failover Isolated Smoke ${new Date().toISOString()}`,
  nodes: ordered,
  connections,
  settings: { executionOrder: 'v1', timezone: 'Europe/Moscow' },
  staticData: null,
  pinData: {},
  active: false,
  tags: [],
};

fs.writeFileSync(outputPath, `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');
process.stdout.write(JSON.stringify({ workflowId, outputPath, nodes: ordered.length }, null, 2));
