const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mark-m10-smokes-'));
const main = JSON.parse(fs.readFileSync(
  path.join(root, 'n8n', 'workflows', 'ai-job-hunter-main.json'),
  'utf8',
));
const mainNodes = new Map(main.nodes.map((node) => [node.name, node]));
let checks = 0;

function check(condition, message) {
  checks += 1;
  assert(condition, message);
}

function nodeMap(workflow) {
  return new Map(workflow.nodes.map((node) => [node.name, node]));
}

try {
  execFileSync(
    process.execPath,
    [path.join(root, 'scripts', 'build-target-m10-smokes.mjs'), temp],
    { stdio: 'pipe' },
  );

  const hh = JSON.parse(fs.readFileSync(
    path.join(temp, 'mark-target-hh-smoke.json'),
    'utf8',
  ));
  const nvidia = JSON.parse(fs.readFileSync(
    path.join(temp, 'mark-target-nvidia-smoke.json'),
    'utf8',
  ));
  const telegram = JSON.parse(fs.readFileSync(
    path.join(temp, 'mark-target-telegram-smoke.json'),
    'utf8',
  ));
  const workflows = [hh, nvidia];

  for (const workflow of workflows) {
    check(workflow.active === false, `${workflow.name} must be inactive`);
    check(Object.keys(workflow.pinData || {}).length === 0, `${workflow.name} pinData`);
    check(
      workflow.nodes.every((node) => node.type !== 'n8n-nodes-base.telegram'),
      `${workflow.name} must not contain Telegram`,
    );
    check(
      workflow.nodes.every((node) => !node.type.includes('scheduleTrigger')),
      `${workflow.name} must not contain Schedule Trigger`,
    );
    check(
      workflow.nodes.every((node) => !node.type.includes('webhook')),
      `${workflow.name} must not contain Webhook Trigger`,
    );
    check(
      workflow.nodes.some((node) => node.type === 'n8n-nodes-base.manualTrigger'),
      `${workflow.name} needs Manual Trigger`,
    );
    check(
      !/(?:nvapi-|gh[pousr]_)[A-Za-z0-9_-]{12,}/.test(JSON.stringify(workflow)),
      `${workflow.name} must not contain literal secrets`,
    );
  }

  const hhNodes = nodeMap(hh);
  for (const name of [
    'Build HH Search Requests',
    'HH Search Vacancies',
    'Parse HH Search Results',
    'Fetch HH Vacancy Details',
    'Normalize HH Vacancy',
  ]) {
    check(hhNodes.has(name), `HH smoke missing ${name}`);
    check(
      JSON.stringify(hhNodes.get(name).parameters) ===
        JSON.stringify(mainNodes.get(name).parameters),
      `HH smoke changed production parameters: ${name}`,
    );
    check(
      JSON.stringify(hhNodes.get(name).credentials || {}) ===
        JSON.stringify(mainNodes.get(name).credentials || {}),
      `HH smoke changed credential reference: ${name}`,
    );
  }

  const nvidiaNodes = nodeMap(nvidia);
  for (const name of [
    'Build NVIDIA Scoring Request',
    'NVIDIA Scorer — Primary',
    'Parse NVIDIA Result — Primary',
    'NVIDIA Scorer — Secondary',
    'Parse NVIDIA Result — Secondary',
    'NVIDIA Scorer — Nano Primary',
    'Parse NVIDIA Result — Nano Primary',
    'NVIDIA Scorer — Nano Secondary',
    'Parse NVIDIA Result — Nano Secondary',
  ]) {
    check(nvidiaNodes.has(name), `NVIDIA smoke missing ${name}`);
    check(
      JSON.stringify(nvidiaNodes.get(name).parameters) ===
        JSON.stringify(mainNodes.get(name).parameters),
      `NVIDIA smoke changed production parameters: ${name}`,
    );
    check(
      JSON.stringify(nvidiaNodes.get(name).credentials || {}) ===
        JSON.stringify(mainNodes.get(name).credentials || {}),
      `NVIDIA smoke changed credential reference: ${name}`,
    );
  }

  check(
    nvidiaNodes.get('Candidate Profile')?.parameters?.jsCode.includes(
      "CANDIDATE_PROFILE_VERSION = '1.4.0'",
    ),
    'NVIDIA smoke must embed Candidate Profile 1.4.0',
  );
  check(
    !nvidiaNodes.has('Build Telegram Vacancy Card') &&
      !nvidiaNodes.has('Send MARK Vacancy Card') &&
      !nvidiaNodes.has('Persist Telegram Delivery Result'),
    'NVIDIA smoke delivery nodes must be removed',
  );
  check(
    hhNodes.get('HH Search Vacancies')?.credentials?.oAuth2Api?.id,
    'HH smoke must retain OAuth credential reference',
  );
  check(
    nvidiaNodes.get('NVIDIA Scorer — Primary')?.credentials?.httpHeaderAuth?.id,
    'NVIDIA smoke must retain primary credential reference',
  );
  check(
    nvidiaNodes.get('NVIDIA Scorer — Secondary')?.credentials?.httpHeaderAuth?.id,
    'NVIDIA smoke must retain secondary credential reference',
  );
  const validatorCode = nvidiaNodes.get(
    'Validate Target NVIDIA Smoke',
  )?.parameters?.jsCode ?? '';
  check(
    validatorCode.includes('row.nvidia_result_valid') &&
      validatorCode.includes('row.ai_assessment'),
    'NVIDIA smoke validator must use the production parser result contract',
  );
  check(
    validatorCode.includes('row.nvidia_credential_alias'),
    'NVIDIA smoke validator must use the production credential alias field',
  );

  const telegramNodes = nodeMap(telegram);
  check(telegram.active === false, 'Telegram smoke must be inactive');
  check(
    Object.keys(telegram.pinData || {}).length === 0,
    'Telegram smoke pinData must be empty',
  );
  check(
    telegram.nodes.filter(
      (node) => node.type === 'n8n-nodes-base.telegram',
    ).length === 1,
    'Telegram smoke must contain exactly one Telegram node',
  );
  check(
    telegram.nodes.every((node) => !node.type.includes('scheduleTrigger')),
    'Telegram smoke must not contain Schedule Trigger',
  );
  check(
    telegram.nodes.every((node) => !node.type.includes('webhook')),
    'Telegram smoke must not contain Webhook Trigger',
  );
  check(
    telegram.nodes.some((node) => node.type === 'n8n-nodes-base.manualTrigger'),
    'Telegram smoke needs Manual Trigger',
  );
  for (const name of [
    'Build Telegram Vacancy Card',
    'Send MARK Vacancy Card',
    'Persist Telegram Delivery Result',
  ]) {
    check(telegramNodes.has(name), `Telegram smoke missing ${name}`);
    check(
      JSON.stringify(telegramNodes.get(name).parameters) ===
        JSON.stringify(mainNodes.get(name).parameters),
      `Telegram smoke changed production parameters: ${name}`,
    );
    check(
      JSON.stringify(telegramNodes.get(name).credentials || {}) ===
        JSON.stringify(mainNodes.get(name).credentials || {}),
      `Telegram smoke changed credential reference: ${name}`,
    );
  }
  const telegramSeedCode = telegramNodes.get(
    'Build Target Telegram Synthetic Vacancy',
  )?.parameters?.jsCode ?? '';
  check(
    telegramSeedCode.includes('MARK TARGET TELEGRAM TEST') &&
      telegramSeedCode.includes('НЕ РЕАЛЬНЫЙ РАБОТОДАТЕЛЬ') &&
      telegramSeedCode.includes('cutover_test: true'),
    'Telegram smoke must be visibly synthetic',
  );
  check(
    telegramSeedCode.includes('mark-target-telegram-smoke-20260725') &&
      telegramSeedCode.includes('example.invalid'),
    'Telegram smoke must use a fixed safe synthetic identity',
  );
  check(
    telegramNodes.get('Send MARK Vacancy Card')?.credentials?.telegramApi?.id,
    'Telegram smoke must retain the production credential reference',
  );
  const telegramValidatorCode = telegramNodes.get(
    'Validate Target Telegram Smoke',
  )?.parameters?.jsCode ?? '';
  check(
    telegramValidatorCode.includes('row.telegram_delivery_success') &&
      telegramValidatorCode.includes('row.telegram_message_id'),
    'Telegram smoke validator must require confirmed delivery',
  );
  check(
    !/(?:nvapi-|gh[pousr]_)[A-Za-z0-9_-]{12,}/.test(JSON.stringify(telegram)),
    'Telegram smoke must not contain literal secrets',
  );

  console.log(`PASS: ${checks} target-provider-smoke checks`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
