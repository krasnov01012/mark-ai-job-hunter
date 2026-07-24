const fs = require('node:fs');
const path = require('node:path');

const code = fs.readFileSync(
  path.join(__dirname, '..', 'n8n', 'code', 'update-run-metrics.js'),
  'utf8',
);
const runNode = new Function('$input', '$getWorkflowStaticData', code);
const state = {
  mark_job_hunter: {
    current_run_id: 'test-run',
    runs: {
      'test-run': {
        rss_items: 0,
        prefilter_pass: 0,
        hard_filter_pass: 0,
        level_pass_or_stretch: 0,
      },
    },
  },
};
const getStatic = () => state;
const checks = [];

function execute(items) {
  return runNode({ all: () => items.map((json) => ({ json })) }, getStatic);
}

function check(name, condition) {
  checks.push([name, Boolean(condition)]);
}

const rss = execute([{ guid: '1' }, { guid: '2' }, { guid: '3' }]);
check('RSS items are preserved', rss.length === 3);
check('RSS metric uses raw item contract', state.mark_job_hunter.runs['test-run'].rss_items === 3);

execute([
  { source: 'headhunter', source_id: '1' },
  { source: 'headhunter', source_id: '2' },
]);
check('HH collection is recorded separately', state.mark_job_hunter.runs['test-run'].by_source.headhunter.rss_items === 2);
check('source collection metrics aggregate', state.mark_job_hunter.runs['test-run'].rss_items === 5);

const prefilter = execute([
  { guid: '1', prefilter_decision: 'PASS' },
  { guid: '2', prefilter_decision: 'REVIEW' },
]);
check('pre-filter items are preserved', prefilter.length === 2);
check('pre-filter metric ignores branch execution history', state.mark_job_hunter.runs['test-run'].prefilter_pass === 2);
check('pre-filter does not overwrite hard metric', state.mark_job_hunter.runs['test-run'].hard_filter_pass === 0);

const hard = execute([{ prefilter_decision: 'PASS', hard_filter_decision: 'PASS' }]);
check('hard-filter metric uses most advanced contract field', state.mark_job_hunter.runs['test-run'].hard_filter_pass === 1);
check('hard-filter does not overwrite pre-filter metric', state.mark_job_hunter.runs['test-run'].prefilter_pass === 2);

const level = execute([
  { prefilter_decision: 'PASS', hard_filter_decision: 'PASS', level_decision: 'PASS' },
  { prefilter_decision: 'PASS', hard_filter_decision: 'PASS', level_decision: 'STRETCH' },
]);
check('level metric uses most advanced contract field', state.mark_job_hunter.runs['test-run'].level_pass_or_stretch === 2);
check('level does not overwrite hard metric', state.mark_job_hunter.runs['test-run'].hard_filter_pass === 1);
check('metrics version is stored', state.mark_job_hunter.runs['test-run'].metrics_version === '1.1.0');
check('metric timestamp is stored', typeof state.mark_job_hunter.runs['test-run'].last_metric_at === 'string');

const failures = checks.filter(([, passed]) => !passed);
if (failures.length > 0) {
  for (const [name] of failures) console.error('FAIL', name);
  process.exitCode = 1;
} else {
  console.log(`PASS: ${checks.length} run-metrics checks`);
}
