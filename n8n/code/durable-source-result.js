/**
 * MARK — Persist Source Result
 * Version: 1.1.0
 * n8n Code node mode: Run Once for Each Item
 *
 * Marks deterministic pre-filter rejects and successfully normalized items as
 * processed. Fetch/normalization failures receive a bounded delayed retry and
 * remain visible in compact workflow error state.
 */

const SOURCE_RESULT_VERSION = '1.1.0';
const STATE_SCHEMA = 'mark.workflow_state.v1';
const RETRY_DELAY_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const MAX_ERRORS = 100;

const inputItem = $input.item;
const json = inputItem?.json ?? {};
const staticData = $getWorkflowStaticData('global');
const root = staticData.mark_job_hunter ?? (staticData.mark_job_hunter = {});

root.schema_version = STATE_SCHEMA;
root.source_items ??= {};
root.runs ??= {};
root.errors ??= [];

function value(...candidates) {
  for (const candidate of candidates) {
    const normalized = String(candidate ?? '').trim();
    if (normalized) return normalized;
  }
  return '';
}

function sourceKey(item) {
  const annotated = value(item.source_state_key);
  if (annotated) return annotated;
  const raw = value(
    item.source_guid,
    item.guid,
    item.vacancy_key,
    item.source_id,
    item.link,
    item.url,
  );
  if (!raw) return '';
  if (/^(?:habr|hh):/i.test(raw)) return raw.toLowerCase().startsWith('hh:') ? `hh:${raw.slice(3)}` : raw;
  const source = value(item.source).toLowerCase();
  const namespace = source === 'headhunter' || source === 'hh' || /(?:api\.)?hh\.ru|headhunter\.ge/i.test(raw)
    ? 'hh'
    : 'habr';
  return `${namespace}:${raw}`;
}

const now = Date.now();
const nowIso = new Date(now).toISOString();
const key = sourceKey(json);
let status = 'untracked';
let reason = 'missing_key_untracked';

if (key) {
  const current = root.source_items[key] ?? {
    key,
    attempts: 1,
    first_seen_at: nowIso,
  };
  const prefilterRejected = json.prefilter_decision === 'REJECT';
  const normalized = json.normalization_ok === true;

  if (prefilterRejected || normalized) {
    status = 'processed';
    reason = prefilterRejected
      ? 'prefilter_reject_completed'
      : `full_page_completed:${String(json.hard_filter_decision ?? 'unknown').toLowerCase()}`;
    root.source_items[key] = {
      ...current,
      status,
      vacancy_key: json.vacancy_key ?? current.vacancy_key ?? null,
      source_id: json.source_id ?? current.source_id ?? null,
      url: json.url ?? json.link ?? current.url ?? null,
      updated_at: nowIso,
      processed_at: nowIso,
      next_retry_at_ms: 0,
      last_reason: reason,
      outcome: prefilterRejected
        ? 'prefilter_reject'
        : String(json.hard_filter_decision ?? 'unknown').toLowerCase(),
    };
  } else {
    const attempts = Math.max(1, Number(current.attempts ?? 1));
    const terminal = attempts >= MAX_ATTEMPTS;
    status = terminal ? 'failed' : 'retry';
    reason = terminal ? 'source_attempt_budget_exhausted' : 'source_retry_scheduled';
    root.source_items[key] = {
      ...current,
      status,
      vacancy_key: json.vacancy_key ?? current.vacancy_key ?? null,
      source_id: json.source_id ?? current.source_id ?? null,
      url: json.url ?? json.link ?? current.url ?? null,
      updated_at: nowIso,
      next_retry_at_ms: terminal ? 0 : now + RETRY_DELAY_MS,
      last_reason: reason,
      normalization_errors: Array.isArray(json.normalization_errors)
        ? json.normalization_errors.slice(0, 6)
        : [],
    };
    root.errors.push({
      scope: 'source_processing',
      source_state_key: key,
      status,
      attempts,
      at: nowIso,
    });
    root.errors = root.errors.slice(-MAX_ERRORS);
  }
}

const run = root.current_run_id ? root.runs[root.current_run_id] : null;
if (run) {
  if (status === 'processed') {
    run.source_processed_count = Number(run.source_processed_count ?? 0) + 1;
  } else if (status === 'retry' || status === 'failed') {
    run.source_error_count = Number(run.source_error_count ?? 0) + 1;
  }
  run.last_source_result_at = nowIso;
}

return {
  ...inputItem,
  json: {
    ...json,
    workflow_state_schema: STATE_SCHEMA,
    source_result_version: SOURCE_RESULT_VERSION,
    source_state_key: key || null,
    source_state_status: status,
    source_state_result_reason: reason,
  },
};
