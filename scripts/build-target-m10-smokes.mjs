import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const outputDir = path.resolve(process.argv[2] ?? path.join(root, '.codex-m10-smokes'));
const sourcePath = path.resolve(
  process.argv[3] ?? path.join(root, 'n8n', 'workflows', 'ai-job-hunter-main.json'),
);
const sourceRaw = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const source = Array.isArray(sourceRaw) ? sourceRaw[0] : sourceRaw;
const sourceNodes = new Map(source.nodes.map((node) => [node.name, node]));

function cloneNode(name) {
  const node = sourceNodes.get(name);
  if (!node) throw new Error(`Production node is missing: ${name}`);
  return structuredClone(node);
}

function manualTrigger(id, name, position = [0, 0]) {
  return {
    parameters: {},
    type: 'n8n-nodes-base.manualTrigger',
    typeVersion: 1,
    position,
    id,
    name,
  };
}

function codeNode({ id, name, jsCode, position, runOnceForEachItem = false }) {
  return {
    parameters: {
      ...(runOnceForEachItem ? { mode: 'runOnceForEachItem' } : {}),
      jsCode,
    },
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position,
    id,
    name,
  };
}

function connect(connections, from, ...targets) {
  connections[from] = {
    main: [targets.map((node) => ({ node, type: 'main', index: 0 }))],
  };
}

function writeWorkflow(name, workflow) {
  const outputPath = path.join(outputDir, name);
  fs.writeFileSync(outputPath, `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');
  return outputPath;
}

function validateNoDelivery(workflow) {
  if (workflow.active !== false) throw new Error(`${workflow.name}: active`);
  if (Object.keys(workflow.pinData || {}).length !== 0) {
    throw new Error(`${workflow.name}: pinData`);
  }
  if (workflow.nodes.some((node) => node.type === 'n8n-nodes-base.telegram')) {
    throw new Error(`${workflow.name}: Telegram node`);
  }
  if (workflow.nodes.some((node) => node.type.includes('scheduleTrigger'))) {
    throw new Error(`${workflow.name}: schedule trigger`);
  }
  if (workflow.nodes.some((node) => node.type.includes('webhook'))) {
    throw new Error(`${workflow.name}: webhook trigger`);
  }
}

function validateOneTelegramDelivery(workflow) {
  if (workflow.active !== false) throw new Error(`${workflow.name}: active`);
  if (Object.keys(workflow.pinData || {}).length !== 0) {
    throw new Error(`${workflow.name}: pinData`);
  }
  const telegramNodes = workflow.nodes.filter(
    (node) => node.type === 'n8n-nodes-base.telegram',
  );
  if (telegramNodes.length !== 1) {
    throw new Error(`${workflow.name}: expected one Telegram node`);
  }
  if (workflow.nodes.some((node) => node.type.includes('scheduleTrigger'))) {
    throw new Error(`${workflow.name}: schedule trigger`);
  }
  if (workflow.nodes.some((node) => node.type.includes('webhook'))) {
    throw new Error(`${workflow.name}: webhook trigger`);
  }
}

fs.mkdirSync(outputDir, { recursive: true });

const hhTrigger = manualTrigger(
  '8ce93791-a0aa-49e4-bc1f-b698ad902a2f',
  'Manual Trigger — Target HH Smoke',
  [0, 0],
);
const hhBuild = cloneNode('Build HH Search Requests');
const hhSearch = cloneNode('HH Search Vacancies');
const hhParse = cloneNode('Parse HH Search Results');
const hhLimit = codeNode({
  id: 'cd1a948f-e259-41d3-9d0e-c66765ad86b2',
  name: 'Limit HH Smoke Details',
  position: [832, 0],
  jsCode: `const items = $input.all();
if (items.length === 0) throw new Error('hh_search_returned_no_items');
return items.slice(0, 2);`,
});
const hhFetch = cloneNode('Fetch HH Vacancy Details');
const hhNormalize = cloneNode('Normalize HH Vacancy');
const hhValidate = codeNode({
  id: '97b05ac6-b13f-4809-9b2d-fb3b415c8d19',
  name: 'Validate Target HH Smoke',
  position: [1456, 0],
  jsCode: `const items = $input.all();
if (items.length === 0) throw new Error('hh_normalizer_returned_no_items');
const rows = items.map((item) => item.json ?? {});
const normalized = rows.filter((row) => row.normalization_ok === true);
if (normalized.length !== rows.length) throw new Error('hh_normalization_failed');
if (rows.some((row) => row.source !== 'headhunter')) throw new Error('hh_source_contract');
return [{
  json: {
    m10_hh_smoke: 'passed',
    normalized_items: normalized.length,
    credential_values_printed: false,
    telegram_called: false,
  },
}];`,
});

const hhConnections = {};
connect(hhConnections, hhTrigger.name, hhBuild.name);
connect(hhConnections, hhBuild.name, hhSearch.name);
connect(hhConnections, hhSearch.name, hhParse.name);
connect(hhConnections, hhParse.name, hhLimit.name);
connect(hhConnections, hhLimit.name, hhFetch.name);
connect(hhConnections, hhFetch.name, hhNormalize.name);
connect(hhConnections, hhNormalize.name, hhValidate.name);

const hhWorkflow = {
  id: 'MARKTargetHHSmoke20260725',
  name: 'MARK — Target HH Provider Smoke',
  active: false,
  nodes: [
    hhTrigger,
    hhBuild,
    hhSearch,
    hhParse,
    hhLimit,
    hhFetch,
    hhNormalize,
    hhValidate,
  ],
  connections: hhConnections,
  settings: {
    ...(source.settings ?? {}),
    executionOrder: 'v1',
  },
  staticData: null,
  pinData: {},
  tags: [],
};
validateNoDelivery(hhWorkflow);

const fullControlledPath = path.join(outputDir, '.m10-controlled-full.json');
execFileSync(
  process.execPath,
  [
    path.join(root, 'scripts', 'build-server-cutover-smoke.mjs'),
    fullControlledPath,
    'controlled',
    sourcePath,
  ],
  { stdio: 'ignore' },
);
const fullControlled = JSON.parse(fs.readFileSync(fullControlledPath, 'utf8'));
fs.unlinkSync(fullControlledPath);

const removedNodeNames = new Set([
  'Needs Telegram Retry',
  'Build Telegram Vacancy Card',
  'Send MARK Vacancy Card',
  'Persist Telegram Delivery Result',
]);
const nvidiaTrigger = fullControlled.nodes.find(
  (node) => node.name === 'Webhook Trigger — Server Cutover Smoke',
);
if (!nvidiaTrigger) throw new Error('Controlled smoke trigger is missing');
const oldTriggerName = nvidiaTrigger.name;
nvidiaTrigger.parameters = {};
nvidiaTrigger.type = 'n8n-nodes-base.manualTrigger';
nvidiaTrigger.typeVersion = 1;
nvidiaTrigger.name = 'Manual Trigger — Target NVIDIA Smoke';
delete nvidiaTrigger.webhookId;

const nvidiaValidate = codeNode({
  id: '6664c5c0-6430-4a98-95f5-3aa5374ed9b6',
  name: 'Validate Target NVIDIA Smoke',
  position: [6656, -144],
  runOnceForEachItem: true,
  jsCode: `const row = $json ?? {};
const assessment = row.ai_assessment ?? {};
if (row.nvidia_result_valid !== true) throw new Error('nvidia_scorer_result_invalid');
if (!Number.isFinite(Number(assessment.score))) throw new Error('nvidia_score_missing');
if (!['APPLY', 'REVIEW', 'SKIP'].includes(assessment.decision)) {
  throw new Error('nvidia_decision_invalid');
}
return {
  json: {
    m10_nvidia_smoke: 'passed',
    score_valid: true,
    decision_valid: true,
    provider_alias_present: Boolean(row.nvidia_credential_alias),
    credential_values_printed: false,
    telegram_called: false,
  },
};`,
});

const nvidiaConnections = {};
for (const [from, value] of Object.entries(fullControlled.connections)) {
  const rewrittenFrom = from === oldTriggerName ? nvidiaTrigger.name : from;
  if (removedNodeNames.has(rewrittenFrom)) continue;
  const outputs = (value.main ?? []).map((output) =>
    (output ?? []).filter((connection) => !removedNodeNames.has(connection.node)),
  );
  if (outputs.some((output) => output.length > 0)) {
    nvidiaConnections[rewrittenFrom] = { main: outputs };
  }
}
for (const deliveryFilter of [
  'Primary Score Needs Delivery',
  'Secondary Score Needs Delivery',
  'Nano Primary Score Needs Delivery',
  'Nano Secondary Score Needs Delivery',
]) {
  connect(nvidiaConnections, deliveryFilter, nvidiaValidate.name);
}

const nvidiaWorkflow = {
  ...fullControlled,
  id: 'MARKTargetNvidiaSmoke20260725',
  name: 'MARK — Target NVIDIA Provider Smoke',
  active: false,
  nodes: [
    ...fullControlled.nodes.filter((node) => !removedNodeNames.has(node.name)),
    nvidiaValidate,
  ],
  connections: nvidiaConnections,
  staticData: null,
  pinData: {},
  tags: [],
};
validateNoDelivery(nvidiaWorkflow);

const telegramTrigger = manualTrigger(
  'c7dd4ef0-2858-479d-bc40-ce422a9b4a55',
  'Manual Trigger — Target Telegram Smoke',
  [0, 0],
);
const telegramSeed = codeNode({
  id: 'fc145af2-70f1-42d3-bf80-82e83da48afc',
  name: 'Build Target Telegram Synthetic Vacancy',
  position: [256, 0],
  jsCode: `return [{
  json: {
    cutover_test: true,
    source: 'mark_target_smoke',
    source_id: 'mark-target-telegram-smoke-20260725',
    source_guid: 'mark-target-telegram-smoke-20260725',
    source_state_key: 'mark-smoke:telegram-20260725',
    vacancy_key: 'mark-smoke:telegram-20260725',
    url: 'https://example.invalid/mark-target-telegram-smoke',
    title: 'MARK TARGET TELEGRAM TEST — тестовая вакансия',
    company: 'MARK TEST — НЕ РЕАЛЬНЫЙ РАБОТОДАТЕЛЬ',
    location: 'Тестовый контур',
    work_format: 'remote',
    salary_specified: false,
    predicted_salary_available: false,
    level_decision: 'JUNIOR',
    ai_assessment: {
      schema: 'mark.ai_assessment.v1',
      score: 99,
      level: 'JUNIOR_PLUS',
      decision: 'APPLY',
      reasons: [
        'Контролируемая проверка прямой доставки с target VPS',
        'Карточка использует production Telegram formatter',
      ],
      gaps: ['Это синтетический тест, а не реальная вакансия'],
      summary: 'ОДНОРАЗОВЫЙ ТЕСТ MARK. Подтвердите получение владельцу.',
      salary_used_in_score: false,
    },
    delivery_required: true,
  },
}];`,
});
const telegramBuild = cloneNode('Build Telegram Vacancy Card');
const telegramSend = cloneNode('Send MARK Vacancy Card');
const telegramPersist = cloneNode('Persist Telegram Delivery Result');
const telegramValidate = codeNode({
  id: 'ef86a229-155f-41cb-b6a3-f4221223e57e',
  name: 'Validate Target Telegram Smoke',
  position: [1280, 0],
  runOnceForEachItem: true,
  jsCode: `const row = $json ?? {};
if (row.cutover_test !== true) throw new Error('telegram_synthetic_marker_missing');
if (row.telegram_delivery_success !== true) throw new Error('telegram_delivery_failed');
if (!row.telegram_message_id) throw new Error('telegram_message_id_missing');
return {
  json: {
    m10_telegram_smoke: 'passed',
    synthetic_test: true,
    telegram_delivery_success: true,
    credential_values_printed: false,
  },
};`,
});

const telegramConnections = {};
connect(telegramConnections, telegramTrigger.name, telegramSeed.name);
connect(telegramConnections, telegramSeed.name, telegramBuild.name);
connect(telegramConnections, telegramBuild.name, telegramSend.name);
connect(telegramConnections, telegramSend.name, telegramPersist.name);
connect(telegramConnections, telegramPersist.name, telegramValidate.name);

const telegramWorkflow = {
  id: 'MARKTargetTelegramSmoke20260725',
  name: 'MARK — Target Telegram Delivery Smoke',
  active: false,
  nodes: [
    telegramTrigger,
    telegramSeed,
    telegramBuild,
    telegramSend,
    telegramPersist,
    telegramValidate,
  ],
  connections: telegramConnections,
  settings: {
    ...(source.settings ?? {}),
    executionOrder: 'v1',
  },
  staticData: null,
  pinData: {},
  tags: [],
};
validateOneTelegramDelivery(telegramWorkflow);

const hhPath = writeWorkflow('mark-target-hh-smoke.json', hhWorkflow);
const nvidiaPath = writeWorkflow('mark-target-nvidia-smoke.json', nvidiaWorkflow);
const telegramPath = writeWorkflow(
  'mark-target-telegram-smoke.json',
  telegramWorkflow,
);

console.log(JSON.stringify({
  hh: {
    file: hhPath,
    nodes: hhWorkflow.nodes.length,
    active: hhWorkflow.active,
  },
  nvidia: {
    file: nvidiaPath,
    nodes: nvidiaWorkflow.nodes.length,
    active: nvidiaWorkflow.active,
  },
  telegram: {
    file: telegramPath,
    nodes: telegramWorkflow.nodes.length,
    active: telegramWorkflow.active,
    telegram_nodes: 1,
  },
  provider_telegram_nodes: 0,
  all_schedule_triggers: 0,
  all_webhook_triggers: 0,
}));
