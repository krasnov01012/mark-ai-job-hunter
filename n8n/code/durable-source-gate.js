/**
 * MARK — Durable Source Gate
 * Version: 1.2.0
 * n8n Code node mode: Run Once for All Items
 *
 * Prevents the same RSS vacancy from being fetched on every execution. New,
 * due-for-retry, and stale in-progress items pass; completed and terminally
 * failed items stay tracked and are skipped.
 */

const SOURCE_GATE_VERSION = '1.2.0';
const STATE_SCHEMA = 'mark.workflow_state.v1';
const PROCESSING_STALE_MS = 20 * 60 * 1000;
const RETENTION_MS = 60 * 24 * 60 * 60 * 1000;
const MAX_SOURCE_ITEMS = 2000;

const inputItems = $input.all();
const staticData = $getWorkflowStaticData('global');
const root = staticData.mark_job_hunter ?? (staticData.mark_job_hunter = {});

root.schema_version = STATE_SCHEMA;
root.source_items ??= {};
root.vacancies ??= {};
root.runs ??= {};
root.errors ??= [];

const now = Date.now();
const nowIso = new Date(now).toISOString();

function value(...candidates) {
  for (const candidate of candidates) {
    const normalized = String(candidate ?? '').trim();
    if (normalized) return normalized;
  }
  return '';
}

function sourceKey(json) {
  const annotated = value(json.source_state_key);
  if (annotated) return annotated;

  const raw = value(
    json.source_guid,
    json.guid,
    json.vacancy_key,
    json.source_id,
    json.link,
    json.url,
  );
  if (!raw) return '';
  if (/^(?:habr|hh):/i.test(raw)) return raw.toLowerCase().startsWith('hh:') ? `hh:${raw.slice(3)}` : raw;

  const source = value(json.source).toLowerCase();
  const namespace = source === 'headhunter' || source === 'hh' || /(?:api\.)?hh\.ru|headhunter\.ge/i.test(raw)
    ? 'hh'
    : 'habr';
  return `${namespace}:${raw}`;
}

if (now - Number(root.last_source_prune_at_ms ?? 0) > 24 * 60 * 60 * 1000) {
  const records = Object.entries(root.source_items)
    .map(([key, record]) => ({
      key,
      updated: Date.parse(record.updated_at ?? record.first_seen_at ?? 0) || 0,
    }))
    .sort((a, b) => b.updated - a.updated);

  for (const entry of records) {
    if (entry.updated > 0 && now - entry.updated > RETENTION_MS) {
      delete root.source_items[entry.key];
    }
  }

  const remaining = Object.entries(root.source_items)
    .map(([key, record]) => ({
      key,
      updated: Date.parse(record.updated_at ?? record.first_seen_at ?? 0) || 0,
    }))
    .sort((a, b) => b.updated - a.updated);
  for (const entry of remaining.slice(MAX_SOURCE_ITEMS)) {
    delete root.source_items[entry.key];
  }
  root.last_source_prune_at_ms = now;
}

const output = [];
let skipped = 0;

for (const item of inputItems) {
  const json = item?.json ?? {};
  const key = sourceKey(json);

  if (!key) {
    output.push({
      ...item,
      json: {
        ...json,
        workflow_state_schema: STATE_SCHEMA,
        source_gate_version: SOURCE_GATE_VERSION,
        source_state_key: null,
        source_state_action: 'process',
        source_state_reason: 'missing_key_untracked',
      },
    });
    continue;
  }

  const record = root.source_items[key];
  const updatedAt = Date.parse(record?.updated_at ?? 0) || 0;
  const retryDue = record?.status === 'retry' && Number(record.next_retry_at_ms ?? 0) <= now;
  const staleProcessing = record?.status === 'processing' && now - updatedAt >= PROCESSING_STALE_MS;
  const vacancyRecord = record?.vacancy_key ? root.vacancies[record.vacancy_key] : null;
  const downstreamRecoveryDue = Boolean(vacancyRecord) && (
    (
      vacancyRecord.scoring_status === 'error' &&
      Number(vacancyRecord.next_retry_at_ms ?? 0) <= now
    ) ||
    (
      vacancyRecord.scoring_status === 'completed' &&
      vacancyRecord.delivery_required === true &&
      vacancyRecord.telegram_sent !== true
    ) ||
    (
      vacancyRecord.scoring_status === 'pending' &&
      now - (Date.parse(vacancyRecord.updated_at ?? 0) || 0) >= PROCESSING_STALE_MS
    )
  );
  const shouldProcess = !record || retryDue || staleProcessing || downstreamRecoveryDue;

  if (!shouldProcess) {
    skipped += 1;
    continue;
  }

  const reason = !record
    ? 'new_source_item'
    : retryDue
      ? 'source_retry_due'
      : staleProcessing
        ? 'stale_source_processing_recovery'
        : 'downstream_recovery_due';

  root.source_items[key] = {
    ...(record ?? {}),
    key,
    status: 'processing',
    attempts: Number(record?.attempts ?? 0) + 1,
    first_seen_at: record?.first_seen_at ?? nowIso,
    updated_at: nowIso,
    next_retry_at_ms: 0,
    last_reason: reason,
  };

  output.push({
    ...item,
    json: {
      ...json,
      workflow_state_schema: STATE_SCHEMA,
      source_gate_version: SOURCE_GATE_VERSION,
      source_state_key: key,
      source_state_action: 'process',
      source_state_reason: reason,
    },
  });
}

const run = root.current_run_id ? root.runs[root.current_run_id] : null;
if (run) {
  const source = inputItems.some((item) => {
    const json = item?.json ?? {};
    const name = value(json.source).toLowerCase();
    return name === 'headhunter' || name === 'hh' || sourceKey(json).startsWith('hh:');
  }) ? 'headhunter' : 'habr';
  run.by_source ??= {};
  run.by_source[source] ??= {};
  run.by_source[source].new_guid_count = output.length;
  run.by_source[source].source_skipped_count = skipped;
  run.new_guid_count = Object.values(run.by_source)
    .reduce((total, metrics) => total + Number(metrics?.new_guid_count ?? 0), 0);
  run.source_skipped_count = Object.values(run.by_source)
    .reduce((total, metrics) => total + Number(metrics?.source_skipped_count ?? 0), 0);
  run.last_source_gate_at = nowIso;
}

return output;
