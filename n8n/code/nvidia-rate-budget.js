/**
 * MARK — NVIDIA Rate Budget
 * Version: 1.0.0
 * n8n Code node mode: Run Once for All Items
 *
 * Enforces one ten-vacancy budget across all source branches in the same run.
 */

const RATE_BUDGET_VERSION = '1.0.0';
const MAX_VACANCIES_PER_RUN = 10;

const items = $input.all();
const staticData = $getWorkflowStaticData('global');
const root = staticData.mark_job_hunter ?? (staticData.mark_job_hunter = {});
root.runs ??= {};

const run = root.current_run_id ? root.runs[root.current_run_id] : null;
const alreadyAdmitted = Math.max(0, Number(run?.nvidia_admitted_count ?? 0));
const remaining = Math.max(0, MAX_VACANCIES_PER_RUN - alreadyAdmitted);
const admitted = items.slice(0, remaining);
const deferred = Math.max(0, items.length - admitted.length);

if (run) {
  run.nvidia_admitted_count = alreadyAdmitted + admitted.length;
  run.nvidia_deferred_count = Number(run.nvidia_deferred_count ?? 0) + deferred;
  run.nvidia_rate_budget_version = RATE_BUDGET_VERSION;
  run.last_nvidia_budget_at = new Date().toISOString();
}

return admitted.map((item) => ({
  ...item,
  json: {
    ...(item?.json ?? {}),
    nvidia_rate_budget_version: RATE_BUDGET_VERSION,
    nvidia_rate_budget_max: MAX_VACANCIES_PER_RUN,
    nvidia_rate_budget_admitted: true,
  },
}));
