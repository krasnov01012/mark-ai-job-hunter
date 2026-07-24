const fs = require('node:fs');
const path = require('node:path');

const initializerCode = fs.readFileSync(
  path.join(__dirname, '..', 'n8n', 'code', 'initialize-run.js'),
  'utf8',
);
const gateCode = fs.readFileSync(
  path.join(__dirname, '..', 'n8n', 'code', 'durable-state-gate.js'),
  'utf8',
);

const runInitializerNode = new Function('$input', '$getWorkflowStaticData', initializerCode);
const runGateNode = new Function('$input', '$getWorkflowStaticData', gateCode);
let checks = 0;

function assert(condition, message) {
  checks += 1;
  if (!condition) throw new Error(message);
}

function state() {
  return {};
}

function initialize(currentState) {
  return runInitializerNode(
    { all: () => [{ json: { timestamp: new Date().toISOString() } }] },
    () => currentState,
  );
}

function vacancy(overrides = {}) {
  return {
    vacancy_key: 'habr:1',
    source: 'habr',
    source_id: '1',
    title: 'Junior AI Engineer',
    company: 'Example',
    url: 'https://example.test/1',
    description: 'This full description must not be stored in durable state.',
    should_continue_to_nvidia_scorer: true,
    ...overrides,
  };
}

function gate(currentState, value = vacancy()) {
  return runGateNode(
    { item: { json: value } },
    () => currentState,
  ).json;
}

const schedulerState = state();
const firstRun = initialize(schedulerState);
assert(firstRun.length === 1, 'First schedule tick must open a run');
assert(firstRun[0].json.run_kind === 'interval_10m', 'Run kind must describe the fixed interval');
assert(firstRun[0].json.schedule_interval_minutes === 10, 'Schedule interval must be ten minutes');

const immediateRun = initialize(schedulerState);
assert(immediateRun.length === 1, 'Manual execution must not be blocked by an internal gate');
assert(schedulerState.mark_job_hunter.scheduler.mode === 'fixed_interval', 'Scheduler state must use fixed interval mode');
assert(!('pending_fast_retry_at_ms' in schedulerState.mark_job_hunter.scheduler), 'Fast retry state must be removed');
assert(!('lock_until_ms' in schedulerState.mark_job_hunter.scheduler), 'Internal scheduler lock must be removed');

const gateState = state();
const first = gate(gateState);
assert(first.vacancy_state_action === 'score', 'New vacancy must be scored');
assert(first.vacancy_state_reason === 'new_vacancy', 'New vacancy reason mismatch');
assert(gateState.mark_job_hunter.vacancies['habr:1'].scoring_status === 'pending', 'New vacancy must persist pending state');
assert(!JSON.stringify(gateState).includes('full description'), 'Durable state must not store full description');

gateState.mark_job_hunter.vacancies['habr:1'] = {
  vacancy_key: 'habr:1',
  scoring_status: 'completed',
  delivery_required: true,
  telegram_sent: false,
  ai_assessment: { score: 80, decision: 'APPLY' },
  updated_at: new Date().toISOString(),
};
const delivery = gate(gateState);
assert(delivery.vacancy_state_action === 'deliver', 'Unsent completed vacancy must retry Telegram only');
assert(delivery.ai_assessment.score === 80, 'Stored assessment must be restored');

gateState.mark_job_hunter.vacancies['habr:1'].telegram_sent = true;
assert(gate(gateState).vacancy_state_action === 'skip', 'Delivered vacancy must be skipped');

gateState.mark_job_hunter.vacancies['habr:1'] = {
  vacancy_key: 'habr:1',
  scoring_status: 'completed',
  delivery_required: false,
  telegram_sent: false,
  updated_at: new Date().toISOString(),
};
assert(gate(gateState).vacancy_state_reason === 'already_scored_no_delivery_required', 'Low score must not be rescored');

gateState.mark_job_hunter.vacancies['habr:1'] = {
  vacancy_key: 'habr:1',
  scoring_status: 'error',
  next_retry_at_ms: Date.now() - 1,
  scoring_attempts: 1,
  updated_at: new Date(Date.now() - 3600000).toISOString(),
};
const due = gate(gateState);
assert(due.vacancy_state_action === 'score', 'Due provider error must retry scoring');
assert(gateState.mark_job_hunter.vacancies['habr:1'].scoring_attempts === 2, 'Retry count must increment');

const blocked = gate(state(), vacancy({ should_continue_to_nvidia_scorer: false }));
assert(blocked.vacancy_state_action === 'skip', 'Closed upstream gate must not score');
assert(blocked.vacancy_state_reason === 'candidate_profile_gate_closed', 'Closed gate must be explained');

console.log(`PASS: ${checks} durable-state checks`);
