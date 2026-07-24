/**
 * MARK — Initialize Run Metrics
 * Version: 2.0.0
 * n8n Code node mode: Run Once for All Items
 *
 * The Schedule Trigger owns cadence. This node always opens a run summary and
 * never blocks manual or scheduled execution with an additional time gate.
 */

const SCHEDULER_VERSION = '2.0.0';
const STATE_SCHEMA = 'mark.workflow_state.v1';
const INTERVAL_MINUTES = 10;
const MAX_RUN_SUMMARIES = 50;

const inputItems = $input.all();
const staticData = $getWorkflowStaticData('global');
const root = staticData.mark_job_hunter ?? (staticData.mark_job_hunter = {});

root.schema_version = STATE_SCHEMA;
root.runs ??= {};
root.errors ??= [];
root.vacancies ??= {};
root.provider_health ??= {};

const now = Date.now();
const startedAt = new Date(now).toISOString();
const previousScheduler = root.scheduler && typeof root.scheduler === 'object'
  ? root.scheduler
  : {};
let emptyRunStreak = Number(previousScheduler.empty_run_streak ?? 0);
let lastCompletedRunId = previousScheduler.last_completed_run_id ?? null;

const previousRun = root.current_run_id ? root.runs[root.current_run_id] : null;
if (previousRun && !previousRun.finished_observed_at) {
  const aiCandidates = Number(previousRun.ai_candidates_count ?? 0);
  const operationalErrors =
    Number(previousRun.source_error_count ?? 0) +
    Number(previousRun.provider_errors_count ?? 0);

  previousRun.finished_observed_at = startedAt;
  previousRun.run_outcome = operationalErrors > 0
    ? 'operational_error'
    : aiCandidates > 0
      ? 'ai_candidates_found'
      : 'clean_empty';

  if (operationalErrors === 0 && aiCandidates === 0) {
    emptyRunStreak += 1;
  } else if (aiCandidates > 0) {
    emptyRunStreak = 0;
  }
  lastCompletedRunId = previousRun.run_id ?? root.current_run_id;
}

const runSequence = Number(previousScheduler.run_sequence ?? 0) + 1;
const runKind = 'interval_10m';
const runId = `${startedAt}_${runKind}_${runSequence}`;

// Replace the legacy scheduler object so obsolete 5/30-minute gate fields do
// not survive in workflow static data.
root.scheduler = {
  mode: 'fixed_interval',
  scheduler_version: SCHEDULER_VERSION,
  interval_minutes: INTERVAL_MINUTES,
  run_sequence: runSequence,
  empty_run_streak: emptyRunStreak,
  last_completed_run_id: lastCompletedRunId,
  last_started_at: startedAt,
  last_run_kind: runKind,
};
root.current_run_id = runId;

root.runs[runId] = {
  run_id: runId,
  run_kind: runKind,
  scheduler_version: SCHEDULER_VERSION,
  schedule_interval_minutes: INTERVAL_MINUTES,
  started_at: startedAt,
  empty_run_streak_at_start: emptyRunStreak,
  rss_items: 0,
  new_guid_count: 0,
  source_skipped_count: 0,
  source_processed_count: 0,
  source_error_count: 0,
  prefilter_pass: 0,
  hard_filter_pass: 0,
  level_pass_or_stretch: 0,
  ai_candidates_count: 0,
  ai_scored_count: 0,
  telegram_sent_count: 0,
  provider_errors_count: 0,
  nvidia_admitted_count: 0,
  nvidia_deferred_count: 0,
  by_source: {},
};

const runIds = Object.keys(root.runs).sort((left, right) => {
  const leftTime = Date.parse(root.runs[left]?.started_at ?? '') || 0;
  const rightTime = Date.parse(root.runs[right]?.started_at ?? '') || 0;
  return leftTime - rightTime || left.localeCompare(right);
});
const staleRunIds = runIds
  .filter((candidateRunId) => candidateRunId !== runId)
  .slice(0, Math.max(0, runIds.length - MAX_RUN_SUMMARIES));
for (const staleRunId of staleRunIds) {
  delete root.runs[staleRunId];
}

const seed = inputItems[0] ?? { json: {} };
return [{
  ...seed,
  json: {
    ...(seed.json ?? {}),
    workflow_state_schema: STATE_SCHEMA,
    scheduler_version: SCHEDULER_VERSION,
    scheduler_mode: 'fixed_interval',
    schedule_interval_minutes: INTERVAL_MINUTES,
    run_id: runId,
    run_kind: runKind,
    empty_run_streak: emptyRunStreak,
    run_started_at: startedAt,
  },
}];
