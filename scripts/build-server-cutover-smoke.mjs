import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const defaultSourcePath = path.join(
  projectRoot,
  'n8n',
  'workflows',
  'ai-job-hunter-main.json',
);
const outputArgument = process.argv[2];
const mode = process.argv[3] ?? 'controlled';
const sourceArgument = process.argv[4];

if (!outputArgument) {
  throw new Error(
    'Usage: node scripts/build-server-cutover-smoke.mjs ' +
      '<output-workflow.json> [controlled|source] [source-workflow.json]',
  );
}
if (!['controlled', 'source'].includes(mode)) {
  throw new Error(`Unsupported cutover smoke mode: ${mode}`);
}

const outputPath = path.resolve(process.cwd(), outputArgument);
const sourcePath = sourceArgument
  ? path.resolve(process.cwd(), sourceArgument)
  : defaultSourcePath;
const parsedSource = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const source = Array.isArray(parsedSource) ? parsedSource[0] : parsedSource;
if (!source || !Array.isArray(source.nodes)) {
  throw new Error(`Workflow source is invalid: ${sourcePath}`);
}

function writeWorkflow(workflow) {
  const nodeNames = new Set(workflow.nodes.map((node) => node.name));
  for (const [sourceName, value] of Object.entries(workflow.connections)) {
    if (!nodeNames.has(sourceName)) {
      throw new Error(`Connection source is missing: ${sourceName}`);
    }
    for (const output of value.main ?? []) {
      for (const connection of output ?? []) {
        if (!nodeNames.has(connection.node)) {
          throw new Error(`Connection target is missing: ${connection.node}`);
        }
      }
    }
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(
    outputPath,
    `${JSON.stringify(workflow, null, 2)}\n`,
    'utf8',
  );

  console.log(JSON.stringify({
    output: outputPath,
    mode,
    workflow_id: workflow.id,
    nodes: workflow.nodes.length,
    connection_roots: Object.keys(workflow.connections).length,
    active: workflow.active,
  }));
}

if (mode === 'source') {
  const workflow = structuredClone(source);
  const scheduleNode = workflow.nodes.find(
    (node) => node.name === 'Schedule Trigger — Every 10 Minutes',
  );
  if (!scheduleNode) {
    throw new Error('Production Schedule Trigger was not found');
  }

  const oldTriggerName = scheduleNode.name;
  const triggerName = 'Execute Workflow Trigger — Server Source Smoke';
  scheduleNode.name = triggerName;
  scheduleNode.type = 'n8n-nodes-base.executeWorkflowTrigger';
  scheduleNode.typeVersion = 1.1;
  scheduleNode.parameters = { inputSource: 'passthrough' };

  workflow.connections[triggerName] = workflow.connections[oldTriggerName];
  delete workflow.connections[oldTriggerName];
  workflow.id = 'MARKServerSourceSmoke';
  workflow.name = 'MARK — Server Source Manual Smoke';
  workflow.active = false;
  workflow.pinData = {};
  workflow.tags = [];

  writeWorkflow(workflow);
  process.exit(0);
}

const sharedNodeNames = new Set([
  'Initialize Run Metrics',
  'Hard Filter — Full Vacancy',
  'Keep Hard Filter PASS',
  'Level Filter Seniority',
  'Keep Level PASS + STRETCH',
  'Candidate Profile',
  'Durable Vacancy State Gate',
  'Needs NVIDIA Score',
  'Needs Telegram Retry',
  'NVIDIA Rate Budget — Max 10 Vacancies',
  'Build NVIDIA Scoring Request',
  'Route NVIDIA Primary',
  'Route NVIDIA Secondary',
  'NVIDIA Scorer — Primary',
  'Parse NVIDIA Result — Primary',
  'Primary Score Needs Delivery',
  'Primary Needs Credential Failover',
  'Primary Needs Model Fallback',
  'NVIDIA Scorer — Secondary',
  'Parse NVIDIA Result — Secondary',
  'Secondary Score Needs Delivery',
  'Secondary Needs Model Fallback',
  'NVIDIA Scorer — Nano Primary',
  'Parse NVIDIA Result — Nano Primary',
  'Nano Primary Score Needs Delivery',
  'Nano Primary Needs Credential Failover',
  'NVIDIA Scorer — Nano Secondary',
  'Parse NVIDIA Result — Nano Secondary',
  'Nano Secondary Score Needs Delivery',
  'Build Telegram Vacancy Card',
  'Send MARK Vacancy Card',
  'Persist Telegram Delivery Result',
]);

const productionNodes = new Map(
  source.nodes.map((node) => [node.name, structuredClone(node)]),
);
const missingNodes = [...sharedNodeNames].filter(
  (nodeName) => !productionNodes.has(nodeName),
);
if (missingNodes.length > 0) {
  throw new Error(`Missing production nodes: ${missingNodes.join(', ')}`);
}

const manualTrigger = {
  parameters: {
    httpMethod: 'POST',
    path: 'mark-server-cutover-smoke-20260723',
    responseMode: 'onReceived',
    options: {},
  },
  id: 'e2a1405e-4d53-4e46-a664-e08aec5c4df1',
  name: 'Webhook Trigger — Server Cutover Smoke',
  type: 'n8n-nodes-base.webhook',
  typeVersion: 2.1,
  position: [-1380, 180],
  webhookId: '831f8bc3-f415-4c86-b0d6-047f014e1715',
};

const controlledVacancy = {
  parameters: {
    jsCode: `/**
 * MARK controlled server cutover vacancy.
 * This item is synthetic and must be visibly distinguishable in Telegram.
 */

const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
const testId = \`mark-cutover-\${stamp}\`;

return [{
  json: {
    cutover_test: true,
    normalization_ok: true,
    normalization_errors: [],
    source: 'headhunter',
    source_id: testId,
    source_guid: testId,
    source_state_key: \`hh:\${testId}\`,
    vacancy_key: \`hh:\${testId}\`,
    url: 'https://example.invalid/mark-cutover-test',
    title: 'Junior AI Engineer — MARK CUTOVER TEST',
    company: 'MARK TEST — NOT A REAL EMPLOYER',
    description: [
      'КОНТРОЛИРУЕМАЯ ТЕСТОВАЯ ВАКАНСИЯ. НЕ ЯВЛЯЕТСЯ РЕАЛЬНЫМ ПРЕДЛОЖЕНИЕМ.',
      'Ищем Junior AI Engineer без обязательного коммерческого AI-опыта.',
      'Задачи: развивать n8n AI-workflows, писать JavaScript в Code nodes,',
      'подключать REST API и RSS, нормализовать JSON, создавать объяснимые',
      'детерминированные фильтры, regression tests, Git-документацию и Telegram delivery.',
      'Подойдут личные инженерные проекты. Требования 5+ лет и senior-уровень отсутствуют.',
    ].join(' '),
    skills: [
      'n8n',
      'JavaScript',
      'REST API',
      'RSS',
      'JSON',
      'Git',
      'Regression testing',
      'AI workflow orchestration',
      'Telegram API',
    ],
    archived: false,
    hidden: false,
    status: 'active',
    work_format: 'remote',
    work_format_confidence: 'high',
    work_format_conflict: false,
    remote_denied: false,
    remote_geo_eligibility: 'not_required',
    location: 'Remote',
    city: null,
    country: null,
    is_tbilisi: false,
    is_georgia: false,
    employment: 'full',
    qualification: 'Junior',
    salary_from: null,
    salary_to: null,
    salary_currency: null,
    predicted_salary_from: null,
    predicted_salary_to: null,
    prefilter_decision: 'PASS',
    title_role_class: 'target',
    target_role_tier: 'A',
    matched_target_roles: ['Junior AI Engineer', 'AI Automation Engineer'],
    matched_adjacent_roles: [],
    matched_absolute_off_target_roles: [],
    matched_soft_off_target_roles: [],
    matched_stack_off_target_roles: [],
    matched_core_ai_work_signals: [
      'Develop AI workflows',
      'Integrate AI APIs',
      'Build deterministic filters',
    ],
    matched_substantive_ai_categories: [
      'AI automation',
      'Workflow orchestration',
      'LLM integration',
    ],
    matched_ai_implementation_signals: [
      'n8n Code nodes',
      'REST API integration',
      'Regression testing',
    ],
    matched_level_categories: ['JUNIOR'],
    matched_experience_signals: [],
    experience_min_years_hint: null,
    experience_max_years_hint: null,
    seniority_risk_hint: 'low',
  },
}];`,
  },
  id: '72ad10f4-0921-41b9-aede-9acfffd08d75',
  name: 'Controlled Vacancy — Matching Criteria',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [-940, 180],
};

const sharedNodes = [...sharedNodeNames].map((nodeName) =>
  productionNodes.get(nodeName),
);
const initializeNode = sharedNodes.find(
  (node) => node.name === 'Initialize Run Metrics',
);
initializeNode.position = [-1160, 180];

const selectedNames = new Set(sharedNodeNames);
const connections = {};

for (const [sourceName, value] of Object.entries(source.connections)) {
  if (!selectedNames.has(sourceName)) continue;

  const filteredOutputs = (value.main ?? []).map((output) =>
    (output ?? []).filter((connection) => selectedNames.has(connection.node)),
  );
  if (filteredOutputs.some((output) => output.length > 0)) {
    connections[sourceName] = { main: filteredOutputs };
  }
}

connections[manualTrigger.name] = {
  main: [[{
    node: 'Initialize Run Metrics',
    type: 'main',
    index: 0,
  }]],
};
connections['Initialize Run Metrics'] = {
  main: [[{
    node: controlledVacancy.name,
    type: 'main',
    index: 0,
  }]],
};
connections[controlledVacancy.name] = {
  main: [[{
    node: 'Hard Filter — Full Vacancy',
    type: 'main',
    index: 0,
  }]],
};
connections['Hard Filter — Full Vacancy'] = {
  main: [[{
    node: 'Keep Hard Filter PASS',
    type: 'main',
    index: 0,
  }]],
};
connections['Keep Hard Filter PASS'] = {
  main: [[{
    node: 'Level Filter Seniority',
    type: 'main',
    index: 0,
  }]],
};
connections['Keep Level PASS + STRETCH'] = {
  main: [[{
    node: 'Candidate Profile',
    type: 'main',
    index: 0,
  }]],
};

const workflow = {
  id: 'MARKServerCutoverSmoke',
  name: 'MARK — Server Cutover Controlled E2E Smoke',
  active: false,
  nodes: [manualTrigger, controlledVacancy, ...sharedNodes],
  connections,
  settings: {
    ...(source.settings ?? {}),
    executionOrder: 'v1',
  },
  staticData: null,
  pinData: {},
  tags: [],
};

const requiredCredentialTypes = new Set(['httpHeaderAuth', 'telegramApi']);
const credentialTypes = new Set(
  workflow.nodes.flatMap((node) => Object.keys(node.credentials ?? {})),
);
for (const type of requiredCredentialTypes) {
  if (!credentialTypes.has(type)) {
    throw new Error(`Controlled smoke is missing ${type} credential reference`);
  }
}

writeWorkflow(workflow);
