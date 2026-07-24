/**
 * MARK — Durable Vacancy State Gate
 * Version: 1.0.0
 * n8n Code node mode: Run Once for Each Item
 *
 * Uses n8n workflow static data as the local MVP persistence backend.
 * Stores only compact operational records, never credentials or full vacancy
 * descriptions. Production executions persist this state between runs.
 */

const STATE_GATE_VERSION = '1.0.0';
const STATE_SCHEMA = 'mark.workflow_state.v1';
const PENDING_STALE_MS = 20 * 60 * 1000;
const RETENTION_MS = 120 * 24 * 60 * 60 * 1000;
const MAX_VACANCIES = 1000;

const inputItem = $input.item;
const vacancy = inputItem?.json ?? {};
const staticData = $getWorkflowStaticData('global');
const root = staticData.mark_job_hunter ?? (staticData.mark_job_hunter = {});

root.schema_version = STATE_SCHEMA;
root.vacancies ??= {};
root.errors ??= [];
root.runs ??= {};

const now = Date.now();
const nowIso = new Date(now).toISOString();

if (now - Number(root.last_vacancy_prune_at_ms ?? 0) > 24 * 60 * 60 * 1000) {
  const records = Object.entries(root.vacancies)
    .map(([key, record]) => ({ key, record, updated: Date.parse(record.updated_at ?? 0) || 0 }))
    .sort((a, b) => b.updated - a.updated);

  for (const entry of records) {
    if (entry.updated > 0 && now - entry.updated > RETENTION_MS) {
      delete root.vacancies[entry.key];
    }
  }

  const remaining = Object.entries(root.vacancies)
    .map(([key, record]) => ({ key, updated: Date.parse(record.updated_at ?? 0) || 0 }))
    .sort((a, b) => b.updated - a.updated);
  for (const entry of remaining.slice(MAX_VACANCIES)) {
    delete root.vacancies[entry.key];
  }
  root.last_vacancy_prune_at_ms = now;
}

const vacancyKey = String(vacancy.vacancy_key ?? '').trim();
let action = 'skip';
let reason = null;
let record = vacancyKey ? root.vacancies[vacancyKey] : null;
const isNew = !record;

if (vacancy.should_continue_to_nvidia_scorer !== true) {
  reason = 'candidate_profile_gate_closed';
} else if (!vacancyKey) {
  reason = 'vacancy_key_missing';
} else if (!record) {
  action = 'score';
  reason = 'new_vacancy';
} else if (record.scoring_status === 'completed') {
  if (record.delivery_required === true && record.telegram_sent !== true) {
    action = 'deliver';
    reason = 'telegram_delivery_pending';
  } else {
    reason = record.telegram_sent === true
      ? 'already_scored_and_delivered'
      : 'already_scored_no_delivery_required';
  }
} else if (record.scoring_status === 'error') {
  if (Number(record.next_retry_at_ms ?? 0) <= now) {
    action = 'score';
    reason = 'provider_retry_due';
  } else {
    reason = 'provider_retry_not_due';
  }
} else if (
  record.scoring_status === 'pending' &&
  now - (Date.parse(record.updated_at ?? 0) || 0) >= PENDING_STALE_MS
) {
  action = 'score';
  reason = 'stale_pending_recovery';
} else {
  reason = 'scoring_already_pending';
}

if (action === 'score') {
  record = {
    ...(record ?? {}),
    vacancy_key: vacancyKey,
    source: vacancy.source ?? null,
    source_id: vacancy.source_id ?? null,
    title: vacancy.title ?? null,
    company: vacancy.company ?? null,
    url: vacancy.url ?? null,
    scoring_status: 'pending',
    scoring_attempts: Number(record?.scoring_attempts ?? 0) + 1,
    first_seen_at: record?.first_seen_at ?? nowIso,
    updated_at: nowIso,
    last_state_reason: reason,
  };
  root.vacancies[vacancyKey] = record;
}

return {
  ...inputItem,
  json: {
    ...vacancy,
    workflow_state_schema: STATE_SCHEMA,
    state_gate_version: STATE_GATE_VERSION,
    vacancy_state_action: action,
    vacancy_state_reason: reason,
    vacancy_is_new: isNew,
    durable_state_backend: 'n8n_workflow_static_data',
    ai_assessment: action === 'deliver' ? record?.ai_assessment ?? null : vacancy.ai_assessment ?? null,
    delivery_required: action === 'deliver' ? true : vacancy.delivery_required ?? false,
  },
};
