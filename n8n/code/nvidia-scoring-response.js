/**
 * MARK — Parse and Persist NVIDIA Score
 * Version: 1.1.0
 * n8n Code node mode: Run Once for Each Item
 *
 * Shared by primary, secondary, and Nano fallback response nodes. It repairs
 * JSON fences deterministically, validates the strict contract, updates the
 * provider circuit state, and persists only a compact AI assessment.
 */

const PARSER_VERSION = '1.1.0';
const SCORER_SCHEMA = 'mark.ai_assessment.v1';
const DELIVERY_THRESHOLD = 65;
const TRANSIENT_COOLDOWN_MS = 60 * 1000;
const TERMINAL_RETRY_MS = 30 * 60 * 1000;
const MAX_ERRORS = 100;

const ROUTES = [
  {
    node: 'NVIDIA Scorer — Nano Secondary',
    credential_alias: 'nvidia_secondary',
    model_id: 'nvidia/nemotron-3-nano-30b-a3b',
    model_role: 'fast_fallback',
  },
  {
    node: 'NVIDIA Scorer — Nano Primary',
    credential_alias: 'nvidia_primary',
    model_id: 'nvidia/nemotron-3-nano-30b-a3b',
    model_role: 'fast_fallback',
  },
  {
    node: 'NVIDIA Scorer — Secondary',
    credential_alias: 'nvidia_secondary',
    model_id: 'nvidia/nemotron-3-super-120b-a12b',
    model_role: 'primary_scorer',
  },
  {
    node: 'NVIDIA Scorer — Primary',
    credential_alias: 'nvidia_primary',
    model_id: 'nvidia/nemotron-3-super-120b-a12b',
    model_role: 'primary_scorer',
  },
];

function nodeWasExecuted(nodeName) {
  try {
    return $(nodeName).isExecuted === true;
  } catch {
    return false;
  }
}

function linkedItem(nodeName) {
  try {
    return $(nodeName).item;
  } catch {
    return null;
  }
}

function originItem(route) {
  const upstreamParsers = {
    'NVIDIA Scorer — Secondary': ['Parse NVIDIA Result — Primary'],
    'NVIDIA Scorer — Nano Primary': ['Parse NVIDIA Result — Primary'],
    'NVIDIA Scorer — Nano Secondary': [
      'Parse NVIDIA Result — Nano Primary',
      'Parse NVIDIA Result — Secondary',
      'Parse NVIDIA Result — Primary',
    ],
  }[route.node] ?? [];

  for (const nodeName of upstreamParsers) {
    if (!nodeWasExecuted(nodeName)) continue;
    const item = linkedItem(nodeName);
    if (item) return item;
  }

  return linkedItem('Build NVIDIA Scoring Request') ?? $input.item;
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function safeArray(value, max) {
  return Array.isArray(value)
    ? value.map(text).filter(Boolean).slice(0, max)
    : [];
}

function extractJson(raw) {
  const source = text(raw);
  if (!source) return { value: null, repaired: false, error: 'assistant_content_missing' };

  const candidates = [source];
  const unfenced = source
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (unfenced !== source) candidates.push(unfenced);
  const firstBrace = unfenced.indexOf('{');
  const lastBrace = unfenced.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(unfenced.slice(firstBrace, lastBrace + 1));
  }

  for (let index = 0; index < candidates.length; index += 1) {
    try {
      return { value: JSON.parse(candidates[index]), repaired: index > 0, error: null };
    } catch {
      // Try the next bounded candidate only.
    }
  }
  return { value: null, repaired: candidates.length > 1, error: 'assistant_json_invalid' };
}

function validateAssessment(value) {
  const errors = [];
  const allowedLevels = new Set(['INTERN', 'JUNIOR', 'JUNIOR_PLUS', 'MIDDLE', 'MIDDLE_PLUS', 'UNKNOWN']);
  const allowedDecisions = new Set(['APPLY', 'REVIEW', 'SKIP']);
  const score = value?.score;
  const level = text(value?.level).toUpperCase();
  const decision = text(value?.decision).toUpperCase();
  const reasons = safeArray(value?.reasons, 6);
  const gaps = safeArray(value?.gaps, 6);
  const summary = text(value?.summary).slice(0, 800);

  if (value?.schema !== SCORER_SCHEMA) errors.push('assessment_schema_mismatch');
  if (!Number.isInteger(score) || score < 0 || score > 100) errors.push('assessment_score_invalid');
  if (!allowedLevels.has(level)) errors.push('assessment_level_invalid');
  if (!allowedDecisions.has(decision)) errors.push('assessment_decision_invalid');
  if (reasons.length === 0) errors.push('assessment_reasons_missing');
  if (!summary) errors.push('assessment_summary_missing');
  if (value?.salary_used_in_score !== false) errors.push('assessment_salary_policy_missing');

  const deterministicDecision = Number.isInteger(score)
    ? score >= 75 ? 'APPLY' : score >= DELIVERY_THRESHOLD ? 'REVIEW' : 'SKIP'
    : null;

  return {
    valid: errors.length === 0,
    errors,
    normalized: errors.length === 0 ? {
      schema: SCORER_SCHEMA,
      score,
      level,
      decision: deterministicDecision,
      model_decision: decision,
      decision_adjusted: deterministicDecision !== decision,
      reasons,
      gaps,
      summary,
      salary_used_in_score: false,
    } : null,
  };
}

function classify({ status, responseBody, networkError, contractValid }) {
  const combined = `${text(networkError?.message)} ${text(networkError?.description)} ${JSON.stringify(responseBody ?? '')}`.toLowerCase();
  if (status >= 200 && status < 300 && contractValid) return 'success';
  if (status === 401 || /missing.*authorization|authorization.*not found/.test(combined)) return 'authentication_error';
  if (status === 403) return 'permission_error';
  if (status === 429) return 'rate_limit';
  if (status === 404) return 'model_unavailable';
  if (status === 400) return 'bad_request';
  if (status === 422) return 'unprocessable_request';
  if (status === 408 || /timeout|timed out|econnaborted|etimedout/.test(combined)) return 'request_timeout';
  if (status >= 500 || /econnreset|enotfound|network/.test(combined)) return 'provider_transient';
  if (status >= 200 && status < 300 && !contractValid) return 'contract_failure';
  return 'unknown_non_retriable';
}

function retryAfterMs(headers, nowMs) {
  if (!headers || typeof headers !== 'object') return null;
  const raw = headers['retry-after'] ?? headers['Retry-After'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const normalized = text(value);
  if (!normalized) return null;

  const seconds = Number(normalized);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.ceil(seconds * 1000), 24 * 60 * 60 * 1000);
  }

  const retryAt = Date.parse(normalized);
  if (!Number.isFinite(retryAt)) return null;
  return Math.min(Math.max(0, retryAt - nowMs), 24 * 60 * 60 * 1000);
}

const responseItem = $input.item;
const responseJson = responseItem?.json ?? {};
const route = ROUTES.find((candidate) => nodeWasExecuted(candidate.node)) ?? ROUTES.at(-1);
const baseItem = originItem(route);
const base = baseItem?.json ?? {};
const status = Number(responseJson.statusCode ?? (responseJson.error ? 0 : 200));
const body = Object.prototype.hasOwnProperty.call(responseJson, 'body')
  ? responseJson.body
  : responseJson;
const assistantContent = body?.choices?.[0]?.message?.content;
const parsed = extractJson(assistantContent);
const validation = validateAssessment(parsed.value);
const errorClass = classify({
  status,
  responseBody: body,
  networkError: responseJson.error,
  contractValid: validation.valid,
});
const now = Date.now();
const retryAfterDelayMs = errorClass === 'rate_limit'
  ? retryAfterMs(responseJson.headers, now)
  : null;

const staticData = $getWorkflowStaticData('global');
const root = staticData.mark_job_hunter ?? (staticData.mark_job_hunter = {});
root.provider_health ??= {};
root.vacancies ??= {};
root.errors ??= [];
root.runs ??= {};

const nowIso = new Date(now).toISOString();
const health = root.provider_health[route.credential_alias] ?? {
  credential_alias: route.credential_alias,
  status: 'healthy',
  consecutive_failures: 0,
  circuit_open_until_ms: 0,
  requires_manual_reset: false,
};

if (errorClass === 'success') {
  health.status = 'healthy';
  health.consecutive_failures = 0;
  health.circuit_open_until_ms = 0;
  health.requires_manual_reset = false;
  health.last_http_status = status;
  health.last_error_class = null;
  health.last_success_at = nowIso;
} else {
  health.consecutive_failures = Number(health.consecutive_failures ?? 0) + 1;
  health.last_http_status = status || null;
  health.last_error_class = errorClass;
  health.last_failure_at = nowIso;

  if (['authentication_error', 'permission_error'].includes(errorClass)) {
    health.status = 'open';
    health.requires_manual_reset = true;
    health.circuit_open_until_ms = 0;
  } else if (errorClass === 'rate_limit') {
    health.status = 'open';
    health.circuit_open_until_ms = now + (retryAfterDelayMs ?? TRANSIENT_COOLDOWN_MS);
    health.rate_limit_reset_at = new Date(health.circuit_open_until_ms).toISOString();
  } else if (['request_timeout', 'provider_transient'].includes(errorClass)) {
    health.status = health.consecutive_failures >= 2 ? 'open' : 'degraded';
    health.circuit_open_until_ms = health.status === 'open' ? now + TRANSIENT_COOLDOWN_MS : 0;
  }
}
root.provider_health[route.credential_alias] = health;

const vacancyKey = String(base.vacancy_key ?? '').trim();
const record = vacancyKey ? (root.vacancies[vacancyKey] ?? { vacancy_key: vacancyKey }) : null;
const isPrimaryModel = route.model_role === 'primary_scorer';
const canCredentialFailover = route.credential_alias === 'nvidia_primary' && [
  'authentication_error',
  'permission_error',
  'rate_limit',
  'request_timeout',
  'provider_transient',
].includes(errorClass);
const canModelFallback = isPrimaryModel && ['model_unavailable', 'contract_failure'].includes(errorClass);
const attemptCount = Math.max(0, Number(base.nvidia_attempt_count ?? 0)) + 1;
const usedCredentialAliases = [...new Set([
  ...(Array.isArray(base.nvidia_used_credential_aliases) ? base.nvidia_used_credential_aliases : []),
  route.credential_alias,
].map(text).filter(Boolean))];
const fallbackReasons = [...new Set([
  ...(Array.isArray(base.nvidia_fallback_reasons) ? base.nvidia_fallback_reasons : []),
  ...((canCredentialFailover || canModelFallback) ? [errorClass] : []),
].map(text).filter(Boolean))];
const fallbackUsed = base.nvidia_fallback_used === true ||
  attemptCount > 1 ||
  route.credential_alias === 'nvidia_secondary' ||
  route.model_role === 'fast_fallback';
const fallbackReason = text(base.nvidia_fallback_reason) || fallbackReasons[0] || null;

let assessment = null;
let deliveryRequired = false;

if (errorClass === 'success') {
  assessment = {
    ...validation.normalized,
    candidate_profile_version: base.candidate_profile_version ?? null,
    scorer_prompt_version: base.scorer_prompt_version ?? null,
    scorer_version: base.scorer_version ?? null,
    parser_version: PARSER_VERSION,
    provider: 'nvidia',
    credential_alias: route.credential_alias,
    model_id: route.model_id,
    model_role: route.model_role,
    attempt_count: attemptCount,
    used_credential_aliases: usedCredentialAliases,
    fallback_used: fallbackUsed,
    fallback_reason: fallbackReason,
    fallback_reasons: fallbackReasons,
    response_repaired: parsed.repaired,
    evaluated_at: nowIso,
  };
  deliveryRequired = assessment.score >= DELIVERY_THRESHOLD && assessment.decision !== 'SKIP';

  if (record) {
    record.scoring_status = 'completed';
    record.ai_assessment = assessment;
    record.delivery_required = deliveryRequired;
    record.telegram_sent = record.telegram_sent === true && record.delivery_required === true;
    record.last_provider_error = null;
    record.next_retry_at_ms = 0;
    record.updated_at = nowIso;
    root.vacancies[vacancyKey] = record;
  }

  const run = root.current_run_id ? root.runs[root.current_run_id] : null;
  if (run) {
    run.ai_scored_count = Number(run.ai_scored_count ?? 0) + 1;
    run.last_ai_score_at = nowIso;
  }
} else if (record) {
  record.provider_attempts = Number(record.provider_attempts ?? 0) + 1;
  record.last_provider_error = {
    error_class: errorClass,
    http_status: status || null,
    credential_alias: route.credential_alias,
    model_id: route.model_id,
    parser_errors: validation.errors,
    at: nowIso,
  };
  record.updated_at = nowIso;

  if (!canCredentialFailover && !canModelFallback) {
    record.scoring_status = 'error';
    record.next_retry_at_ms = now + TERMINAL_RETRY_MS;
  }
  root.vacancies[vacancyKey] = record;

  root.errors.push({
    scope: 'nvidia_scorer',
    vacancy_key: vacancyKey || null,
    error_class: errorClass,
    http_status: status || null,
    credential_alias: route.credential_alias,
    model_id: route.model_id,
    at: nowIso,
  });
  root.errors = root.errors.slice(-MAX_ERRORS);

  const run = root.current_run_id ? root.runs[root.current_run_id] : null;
  if (run) run.provider_errors_count = Number(run.provider_errors_count ?? 0) + 1;
}

return {
  ...responseItem,
  json: {
    ...base,
    nvidia_parser_version: PARSER_VERSION,
    nvidia_http_status: status || null,
    nvidia_error_class: errorClass,
    nvidia_contract_errors: validation.errors,
    nvidia_response_repaired: parsed.repaired,
    nvidia_result_valid: errorClass === 'success',
    nvidia_credential_alias: route.credential_alias,
    nvidia_model_id: route.model_id,
    nvidia_attempt_count: attemptCount,
    nvidia_used_credential_aliases: usedCredentialAliases,
    nvidia_fallback_used: fallbackUsed,
    nvidia_fallback_reason: fallbackReason,
    nvidia_fallback_reasons: fallbackReasons,
    nvidia_retry_after_ms: retryAfterDelayMs,
    should_failover_credential: canCredentialFailover,
    should_model_fallback: canModelFallback,
    ai_assessment: assessment,
    delivery_required: deliveryRequired,
  },
};
