/**
 * MARK — Run Metrics
 * Version: 1.1.0
 * n8n Code node mode: Run Once for All Items
 *
 * The same source is embedded in four metric nodes. Item contract fields
 * identify the stage, so branch execution order cannot misclassify a metric.
 */

const METRICS_VERSION = '1.1.0';
const items = $input.all();
const staticData = $getWorkflowStaticData('global');
const root = staticData.mark_job_hunter ?? (staticData.mark_job_hunter = {});
root.runs ??= {};

const jsonItems = items.map((item) => item?.json ?? {});
let metric = 'rss_items';
if (jsonItems.some((json) => Object.prototype.hasOwnProperty.call(json, 'level_decision'))) {
  metric = 'level_pass_or_stretch';
} else if (jsonItems.some((json) => Object.prototype.hasOwnProperty.call(json, 'hard_filter_decision'))) {
  metric = 'hard_filter_pass';
} else if (jsonItems.some((json) => Object.prototype.hasOwnProperty.call(json, 'prefilter_decision'))) {
  metric = 'prefilter_pass';
}

const run = root.current_run_id ? root.runs[root.current_run_id] : null;
if (run && metric) {
  run.by_source ??= {};
  const source = jsonItems.some((json) => {
    const value = String(json.source ?? '').toLowerCase();
    return value === 'headhunter' || value === 'hh' || String(json.vacancy_key ?? '').startsWith('hh:');
  }) ? 'headhunter' : 'habr';
  run.by_source[source] ??= {};
  run.by_source[source][metric] = items.length;
  run[metric] = Object.values(run.by_source)
    .reduce((total, sourceMetrics) => total + Number(sourceMetrics?.[metric] ?? 0), 0);
  run.metrics_version = METRICS_VERSION;
  run.last_metric_at = new Date().toISOString();
}

return items;
