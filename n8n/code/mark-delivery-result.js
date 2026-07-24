/**
 * MARK — Persist Telegram Delivery Result
 * Version: 1.0.0
 * n8n Code node mode: Run Once for Each Item
 */

const DELIVERY_VERSION = '1.0.0';
const RETRY_DELAY_MS = 30 * 60 * 1000;
const MAX_ERRORS = 100;

function cardItem() {
  try {
    return $('Build Telegram Vacancy Card').item;
  } catch {
    return $input.item;
  }
}

const responseItem = $input.item;
const response = responseItem?.json ?? {};
const baseItem = cardItem();
const base = baseItem?.json ?? {};
const messageId = response.message_id ?? response.result?.message_id ?? null;
const success = !response.error && (response.ok === true || messageId != null || Object.keys(response).length > 0);

const staticData = $getWorkflowStaticData('global');
const root = staticData.mark_job_hunter ?? (staticData.mark_job_hunter = {});
root.vacancies ??= {};
root.errors ??= [];
root.runs ??= {};

const now = Date.now();
const nowIso = new Date(now).toISOString();
const vacancyKey = String(base.vacancy_key ?? '').trim();
const record = vacancyKey ? root.vacancies[vacancyKey] : null;

if (record) {
  record.telegram_attempts = Number(record.telegram_attempts ?? 0) + 1;
  record.updated_at = nowIso;
  if (success) {
    record.telegram_sent = true;
    record.telegram_sent_at = nowIso;
    record.telegram_message_id = messageId;
    record.last_telegram_error = null;
  } else {
    record.telegram_sent = false;
    record.next_delivery_retry_at_ms = now + RETRY_DELAY_MS;
    record.last_telegram_error = {
      message: String(response.error?.message ?? response.error ?? 'telegram_delivery_failed').slice(0, 300),
      at: nowIso,
    };
  }
}

if (success) {
  const run = root.current_run_id ? root.runs[root.current_run_id] : null;
  if (run) run.telegram_sent_count = Number(run.telegram_sent_count ?? 0) + 1;
} else {
  root.errors.push({
    scope: 'telegram_delivery',
    vacancy_key: vacancyKey || null,
    message: String(response.error?.message ?? response.error ?? 'telegram_delivery_failed').slice(0, 300),
    at: nowIso,
  });
  root.errors = root.errors.slice(-MAX_ERRORS);
}

return {
  ...responseItem,
  json: {
    ...base,
    telegram_delivery_version: DELIVERY_VERSION,
    telegram_delivery_success: success,
    telegram_message_id: messageId,
    telegram_delivery_error: success
      ? null
      : String(response.error?.message ?? response.error ?? 'telegram_delivery_failed').slice(0, 300),
  },
};
