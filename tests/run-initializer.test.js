const fs = require('node:fs');
const path = require('node:path');

const code = fs.readFileSync(
  path.join(__dirname, '..', 'n8n', 'code', 'initialize-run.js'),
  'utf8',
);
const runNode = new Function('$input', '$getWorkflowStaticData', code);
const RealDate = Date;
let now = Date.parse('2026-07-16T12:00:00.000Z');

class FakeDate extends RealDate {
  constructor(value) {
    super(value === undefined ? now : value);
  }

  static now() {
    return now;
  }
}

global.Date = FakeDate;

const state = {};
const getStatic = () => state;
const input = { all: () => [{ json: { trigger: 'schedule' } }] };
const checks = [];

function check(name, condition) {
  checks.push([name, Boolean(condition)]);
}

try {
  const first = runNode(input, getStatic);
  const root = state.mark_job_hunter;
  const firstRunId = root.current_run_id;
  check('first trigger always opens a run', first.length === 1);
  check('input fields are preserved', first[0].json.trigger === 'schedule');
  check('fixed interval is exposed', first[0].json.schedule_interval_minutes === 10);
  check('run kind matches fixed cadence', first[0].json.run_kind === 'interval_10m');
  check('scheduler state uses fixed interval mode', root.scheduler.mode === 'fixed_interval');
  check('scheduler state stores ten minutes', root.scheduler.interval_minutes === 10);
  check('run summary starts with source metrics', root.runs[firstRunId].new_guid_count === 0);

  const second = runNode(input, getStatic);
  const secondRunId = root.current_run_id;
  check('immediate manual re-execution is not blocked', second.length === 1);
  check('immediate executions receive unique run ids', secondRunId !== firstRunId);
  check('previous clean run is finalized', root.runs[firstRunId].run_outcome === 'clean_empty');
  check('clean empty streak increments', root.scheduler.empty_run_streak === 1);
  check('legacy next regular field is removed', !('next_regular_run_at_ms' in root.scheduler));
  check('legacy fast retry field is removed', !('pending_fast_retry_at_ms' in root.scheduler));
  check('legacy lock field is removed', !('lock_until_ms' in root.scheduler));

  root.runs[secondRunId].ai_candidates_count = 1;
  now += 10 * 60 * 1000;
  const third = runNode(input, getStatic);
  check('next ten-minute trigger opens a run', third.length === 1);
  check('candidate run is finalized', root.runs[secondRunId].run_outcome === 'ai_candidates_found');
  check('candidate resets empty streak', root.scheduler.empty_run_streak === 0);
} finally {
  global.Date = RealDate;
}

const failures = checks.filter(([, passed]) => !passed);
if (failures.length > 0) {
  for (const [name] of failures) console.error('FAIL', name);
  process.exitCode = 1;
} else {
  console.log(`PASS: ${checks.length} run-initializer checks`);
}
