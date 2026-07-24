const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const gateCode = fs.readFileSync(path.join(root, 'n8n', 'code', 'durable-source-gate.js'), 'utf8');
const resultCode = fs.readFileSync(path.join(root, 'n8n', 'code', 'durable-source-result.js'), 'utf8');
const runGateNode = new Function('$input', '$getWorkflowStaticData', gateCode);
const runResultNode = new Function('$input', '$getWorkflowStaticData', resultCode);

const state = {};
const getStatic = () => state;

function gate(items) {
  return runGateNode({ all: () => items.map((json) => ({ json })) }, getStatic);
}

function persist(json) {
  return runResultNode({ item: { json } }, getStatic).json;
}

const checks = [];
function check(name, condition) {
  checks.push([name, Boolean(condition)]);
}

const first = gate([{ guid: 'https://career.habr.com/vacancies/1' }]);
check('new source item passes', first.length === 1);
check('new source item is annotated', first[0].json.source_state_reason === 'new_source_item');
check('new source item becomes processing', state.mark_job_hunter.source_items[first[0].json.source_state_key].status === 'processing');
check('first attempt is counted', state.mark_job_hunter.source_items[first[0].json.source_state_key].attempts === 1);

const immediateDuplicate = gate([{ guid: 'https://career.habr.com/vacancies/1' }]);
check('in-progress duplicate is skipped', immediateDuplicate.length === 0);

const completed = persist({
  source_guid: 'https://career.habr.com/vacancies/1',
  vacancy_key: 'habr:1',
  normalization_ok: true,
  hard_filter_decision: 'PASS',
});
check('normalized source is processed', completed.source_state_status === 'processed');
check('processed outcome is retained', state.mark_job_hunter.source_items[completed.source_state_key].outcome === 'pass');
check('processed duplicate is skipped', gate([{ guid: 'https://career.habr.com/vacancies/1' }]).length === 0);

state.mark_job_hunter.vacancies['habr:1'] = {
  scoring_status: 'completed',
  delivery_required: true,
  telegram_sent: false,
};
const deliveryRecovery = gate([{ guid: 'https://career.habr.com/vacancies/1' }]);
check('pending Telegram delivery reopens source', deliveryRecovery.length === 1);
check('delivery recovery reason is explicit', deliveryRecovery[0].json.source_state_reason === 'downstream_recovery_due');
persist({
  ...deliveryRecovery[0].json,
  vacancy_key: 'habr:1',
  normalization_ok: true,
  hard_filter_decision: 'PASS',
});
state.mark_job_hunter.vacancies['habr:1'] = {
  scoring_status: 'error',
  next_retry_at_ms: 0,
};
check('due NVIDIA retry reopens source', gate([{ guid: 'https://career.habr.com/vacancies/1' }]).length === 1);
state.mark_job_hunter.vacancies['habr:1'] = {
  scoring_status: 'completed',
  delivery_required: false,
  telegram_sent: false,
};

const rejectedStart = gate([{ guid: 'https://career.habr.com/vacancies/2' }])[0].json;
const rejected = persist({ ...rejectedStart, prefilter_decision: 'REJECT' });
check('prefilter reject is finalized', rejected.source_state_status === 'processed');
check('prefilter reject outcome is explicit', state.mark_job_hunter.source_items[rejected.source_state_key].outcome === 'prefilter_reject');

const failedStart = gate([{ guid: 'https://career.habr.com/vacancies/3' }])[0].json;
const retry = persist({ ...failedStart, normalization_ok: false, normalization_errors: ['broken_html'] });
check('normalization failure schedules retry', retry.source_state_status === 'retry');
check('retry has a future timestamp', state.mark_job_hunter.source_items[retry.source_state_key].next_retry_at_ms > Date.now());
check('retry not due is skipped', gate([{ guid: 'https://career.habr.com/vacancies/3' }]).length === 0);

state.mark_job_hunter.source_items[retry.source_state_key].next_retry_at_ms = 0;
const secondAttempt = gate([{ guid: 'https://career.habr.com/vacancies/3' }])[0].json;
check('due retry passes', secondAttempt.source_state_reason === 'source_retry_due');
check('second attempt is counted', state.mark_job_hunter.source_items[retry.source_state_key].attempts === 2);
persist({ ...secondAttempt, normalization_ok: false });
state.mark_job_hunter.source_items[retry.source_state_key].next_retry_at_ms = 0;
const thirdAttempt = gate([{ guid: 'https://career.habr.com/vacancies/3' }])[0].json;
const terminal = persist({ ...thirdAttempt, normalization_ok: false });
check('third failure is terminally tracked', terminal.source_state_status === 'failed');
check('terminal failure is not silently retried', gate([{ guid: 'https://career.habr.com/vacancies/3' }]).length === 0);
check('source failures are logged', state.mark_job_hunter.errors.some((entry) => entry.scope === 'source_processing'));

const untracked = gate([{ title: 'missing identifiers' }]);
check('missing key still passes', untracked.length === 1);
check('missing key is clearly untracked', untracked[0].json.source_state_reason === 'missing_key_untracked');

const hhFirst = gate([{ source: 'headhunter', source_id: '9001', vacancy_key: 'hh:9001' }]);
check('new HH source item passes', hhFirst.length === 1);
check('HH source namespace is preserved', hhFirst[0].json.source_state_key === 'hh:9001');
const hhCompleted = persist({
  ...hhFirst[0].json,
  source: 'headhunter',
  source_id: '9001',
  vacancy_key: 'hh:9001',
  normalization_ok: true,
  hard_filter_decision: 'PASS',
});
check('normalized HH source is processed', hhCompleted.source_state_status === 'processed');
check('processed HH duplicate is skipped', gate([{ source: 'headhunter', source_id: '9001' }]).length === 0);

state.mark_job_hunter.current_run_id = 'multi-source-run';
state.mark_job_hunter.runs['multi-source-run'] = {
  new_guid_count: 2,
  source_skipped_count: 3,
  by_source: {
    habr: { new_guid_count: 2, source_skipped_count: 3 },
  },
};
const hhMetricBatch = [
  { source: 'headhunter', source_id: '9002' },
  { source: 'headhunter', source_id: '9003' },
];
check('HH gate records per-source new count', gate(hhMetricBatch).length === 2
  && state.mark_job_hunter.runs['multi-source-run'].by_source.headhunter.new_guid_count === 2);
check('source gate aggregates new counts across Habr and HH', state.mark_job_hunter.runs['multi-source-run'].new_guid_count === 4);
gate(hhMetricBatch);
check('HH gate records per-source skipped count', state.mark_job_hunter.runs['multi-source-run'].by_source.headhunter.source_skipped_count === 2);
check('source gate aggregates skipped counts across Habr and HH', state.mark_job_hunter.runs['multi-source-run'].source_skipped_count === 5);

const failures = checks.filter(([, passed]) => !passed);
if (failures.length > 0) {
  for (const [name] of failures) console.error('FAIL', name);
  process.exitCode = 1;
} else {
  console.log(`PASS: ${checks.length} durable-source-state checks`);
}
