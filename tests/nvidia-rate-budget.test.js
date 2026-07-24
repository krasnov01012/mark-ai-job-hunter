const fs = require('node:fs');
const path = require('node:path');

const code = fs.readFileSync(
  path.join(__dirname, '..', 'n8n', 'code', 'nvidia-rate-budget.js'),
  'utf8',
);
const runNode = new Function('$input', '$getWorkflowStaticData', code);
const state = {
  mark_job_hunter: {
    current_run_id: 'test-run',
    runs: { 'test-run': { nvidia_admitted_count: 0, nvidia_deferred_count: 0 } },
  },
};
const getStatic = () => state;
const checks = [];

function execute(count, source) {
  const items = Array.from({ length: count }, (_, index) => ({
    json: { vacancy_key: `${source}:${index}`, source },
  }));
  return runNode({ all: () => items }, getStatic);
}

function check(name, condition) {
  checks.push([name, Boolean(condition)]);
}

const first = execute(7, 'habr');
check('first source admits seven', first.length === 7);
check('admitted items are annotated', first.every((item) => item.json.nvidia_rate_budget_admitted === true));

const second = execute(6, 'headhunter');
check('second source only receives remaining budget', second.length === 3);
check('global run admission is capped at ten', state.mark_job_hunter.runs['test-run'].nvidia_admitted_count === 10);
check('three overflow vacancies are deferred', state.mark_job_hunter.runs['test-run'].nvidia_deferred_count === 3);

const third = execute(1, 'headhunter');
check('exhausted run budget admits nothing', third.length === 0);
check('later overflow remains counted', state.mark_job_hunter.runs['test-run'].nvidia_deferred_count === 4);
check('budget version is persisted', state.mark_job_hunter.runs['test-run'].nvidia_rate_budget_version === '1.0.0');
check('budget timestamp is persisted', typeof state.mark_job_hunter.runs['test-run'].last_nvidia_budget_at === 'string');

const failures = checks.filter(([, passed]) => !passed);
if (failures.length > 0) {
  for (const [name] of failures) console.error('FAIL', name);
  process.exitCode = 1;
} else {
  console.log(`PASS: ${checks.length} NVIDIA rate-budget checks`);
}
