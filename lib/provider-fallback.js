'use strict';

const ACTION = Object.freeze({
  SUCCESS: 'SUCCESS',
  RETRY_SAME_CREDENTIAL: 'RETRY_SAME_CREDENTIAL',
  FAILOVER_CREDENTIAL: 'FAILOVER_CREDENTIAL',
  DEFER_RETRY: 'DEFER_RETRY',
  REPAIR_RESPONSE: 'REPAIR_RESPONSE',
  MODEL_FALLBACK: 'MODEL_FALLBACK',
  STOP_AUTH_UNAVAILABLE: 'STOP_AUTH_UNAVAILABLE',
  STOP_REQUEST_INVALID: 'STOP_REQUEST_INVALID',
  STOP_NON_RETRIABLE: 'STOP_NON_RETRIABLE',
  STOP_BUDGET_EXHAUSTED: 'STOP_BUDGET_EXHAUSTED',
});

const ERROR_CLASS = Object.freeze({
  SUCCESS: 'success',
  AUTHENTICATION: 'authentication_error',
  PERMISSION: 'permission_error',
  RATE_LIMIT: 'rate_limit',
  NETWORK_TRANSIENT: 'network_transient',
  REQUEST_TIMEOUT: 'request_timeout',
  REQUEST_CONFLICT: 'request_conflict',
  PROVIDER_TRANSIENT: 'provider_transient',
  BAD_REQUEST: 'bad_request',
  UNPROCESSABLE_REQUEST: 'unprocessable_request',
  MODEL_UNAVAILABLE: 'model_unavailable',
  CONTRACT_FAILURE: 'contract_failure',
  SAFETY_REFUSAL: 'safety_refusal',
  UNKNOWN_NON_RETRIABLE: 'unknown_non_retriable',
});

const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNABORTED',
  'ECONNRESET',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
]);

function normalizeStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

function extractErrorText(outcome) {
  const parts = [outcome.message, outcome.detail, outcome.errorMessage];
  if (typeof outcome.body === 'string') parts.push(outcome.body);
  if (outcome.body && typeof outcome.body === 'object') {
    parts.push(outcome.body.message, outcome.body.detail, outcome.body.error?.message);
  }
  return parts.filter(Boolean).join(' ');
}

function classifyProviderOutcome(outcome = {}) {
  if (outcome.safetyRefusal === true) return ERROR_CLASS.SAFETY_REFUSAL;

  const status = normalizeStatus(outcome.status);
  const networkCode = String(outcome.networkCode || '').toUpperCase();
  const errorText = extractErrorText(outcome);

  if (/missing[^.]*authorization|authorization[^.]*not found|bearer[^.]*not found/i.test(errorText)) {
    return ERROR_CLASS.AUTHENTICATION;
  }

  if (networkCode) {
    if (networkCode.includes('TIMEOUT') || networkCode === 'ECONNABORTED' || networkCode === 'ETIMEDOUT') {
      return ERROR_CLASS.REQUEST_TIMEOUT;
    }
    if (TRANSIENT_NETWORK_CODES.has(networkCode)) return ERROR_CLASS.NETWORK_TRANSIENT;
  }

  if (status === null && outcome.ok !== true) return ERROR_CLASS.NETWORK_TRANSIENT;
  if (status === 401) return ERROR_CLASS.AUTHENTICATION;
  if (status === 403) return ERROR_CLASS.PERMISSION;
  if (status === 404) return ERROR_CLASS.MODEL_UNAVAILABLE;
  if (status === 408) return ERROR_CLASS.REQUEST_TIMEOUT;
  if (status === 409) return ERROR_CLASS.REQUEST_CONFLICT;
  if (status === 429) return ERROR_CLASS.RATE_LIMIT;
  if (status === 400) return ERROR_CLASS.BAD_REQUEST;
  if (status === 422) return ERROR_CLASS.UNPROCESSABLE_REQUEST;
  if (status !== null && status >= 500) return ERROR_CLASS.PROVIDER_TRANSIENT;
  if (status !== null && status >= 400) return ERROR_CLASS.UNKNOWN_NON_RETRIABLE;

  if (outcome.ok === true || (status !== null && status >= 200 && status < 300)) {
    return outcome.contractValid === false ? ERROR_CLASS.CONTRACT_FAILURE : ERROR_CLASS.SUCCESS;
  }

  return ERROR_CLASS.UNKNOWN_NON_RETRIABLE;
}

function isCircuitOpen(record = {}, nowMs = Date.now()) {
  if (record.status !== 'open') return false;
  if (record.requires_manual_reset === true) return true;
  const openUntil = Number(record.circuit_open_until_ms || 0);
  return openUntil === 0 || openUntil > nowMs;
}

function selectCredential(credentials, health = {}, usedAliases = [], nowMs = Date.now()) {
  const used = new Set(usedAliases);
  return [...credentials]
    .sort((left, right) => left.priority - right.priority)
    .find((entry) => !used.has(entry.alias) && !isCircuitOpen(health[entry.alias], nowMs)) || null;
}

function computeBackoffMs(retryIndex, policy, random = Math.random) {
  const base = policy.backoff.base_ms * (2 ** Math.max(0, retryIndex));
  const capped = Math.min(base, policy.backoff.max_ms);
  const jitter = capped * policy.backoff.jitter_ratio * ((random() * 2) - 1);
  return Math.max(0, Math.round(capped + jitter));
}

function hasAttemptBudget(state, policy) {
  return state.attempts_total < policy.limits.max_total_attempts;
}

function fallbackCredential(state, policy, health, nowMs) {
  if (state.credential_failovers >= policy.limits.max_credential_failovers) return null;
  return selectCredential(policy.credentials, health, state.used_credential_aliases, nowMs);
}

function transientCircuitUpdate(state, policy, nowMs) {
  const recordedFailures = Number(state.consecutive_failures || 0);
  const inferredFailures = Number(state.same_credential_retries || 0);
  const failures = Math.max(recordedFailures, inferredFailures) + 1;
  if (failures >= policy.circuit_breaker.transient_failure_threshold) {
    return {
      status: 'open',
      consecutive_failures: failures,
      circuit_open_until_ms: nowMs + policy.circuit_breaker.transient_cooldown_ms,
    };
  }
  return { status: 'degraded', consecutive_failures: failures };
}

function nextProviderAction({ outcome, state, policy, health = {}, nowMs = Date.now(), random = Math.random }) {
  const errorClass = classifyProviderOutcome(outcome);
  const base = { error_class: errorClass, credential_alias: state.current_credential_alias };

  if (errorClass === ERROR_CLASS.SUCCESS) return { ...base, action: ACTION.SUCCESS };

  if ([ERROR_CLASS.BAD_REQUEST, ERROR_CLASS.UNPROCESSABLE_REQUEST].includes(errorClass)) {
    return { ...base, action: ACTION.STOP_REQUEST_INVALID };
  }

  if ([ERROR_CLASS.SAFETY_REFUSAL, ERROR_CLASS.UNKNOWN_NON_RETRIABLE].includes(errorClass)) {
    return { ...base, action: ACTION.STOP_NON_RETRIABLE };
  }

  if (errorClass === ERROR_CLASS.CONTRACT_FAILURE) {
    if (state.response_repairs < policy.limits.max_response_repairs) {
      return { ...base, action: ACTION.REPAIR_RESPONSE };
    }
    if (state.model_fallbacks < policy.limits.max_model_fallbacks) {
      return { ...base, action: ACTION.MODEL_FALLBACK };
    }
    return { ...base, action: ACTION.STOP_BUDGET_EXHAUSTED };
  }

  if (errorClass === ERROR_CLASS.MODEL_UNAVAILABLE) {
    return state.model_fallbacks < policy.limits.max_model_fallbacks
      ? { ...base, action: ACTION.MODEL_FALLBACK }
      : { ...base, action: ACTION.STOP_BUDGET_EXHAUSTED };
  }

  if ([ERROR_CLASS.AUTHENTICATION, ERROR_CLASS.PERMISSION].includes(errorClass)) {
    const alternate = hasAttemptBudget(state, policy)
      ? fallbackCredential(state, policy, health, nowMs)
      : null;
    return alternate
      ? {
          ...base,
          action: ACTION.FAILOVER_CREDENTIAL,
          next_credential_alias: alternate.alias,
          circuit_update: { status: 'open', requires_manual_reset: true },
        }
      : { ...base, action: ACTION.STOP_AUTH_UNAVAILABLE };
  }

  if (errorClass === ERROR_CLASS.RATE_LIMIT) {
    const retryAfterMs = Number(outcome.retryAfterMs || 0);
    const cooldownMs = retryAfterMs > 0 ? retryAfterMs : policy.circuit_breaker.rate_limit_cooldown_ms;
    const alternate = hasAttemptBudget(state, policy)
      ? fallbackCredential(state, policy, health, nowMs)
      : null;
    if (alternate) {
      return {
        ...base,
        action: ACTION.FAILOVER_CREDENTIAL,
        next_credential_alias: alternate.alias,
        delay_ms: 0,
        circuit_update: { status: 'open', circuit_open_until_ms: nowMs + cooldownMs },
      };
    }
    if (!hasAttemptBudget(state, policy)) {
      return {
        ...base,
        action: ACTION.STOP_BUDGET_EXHAUSTED,
        circuit_update: { status: 'open', circuit_open_until_ms: nowMs + cooldownMs },
      };
    }
    return {
      ...base,
      action: ACTION.DEFER_RETRY,
      delay_ms: cooldownMs,
      circuit_update: { status: 'open', circuit_open_until_ms: nowMs + cooldownMs },
    };
  }

  const retryableSameCredential = [
    ERROR_CLASS.NETWORK_TRANSIENT,
    ERROR_CLASS.REQUEST_TIMEOUT,
    ERROR_CLASS.REQUEST_CONFLICT,
    ERROR_CLASS.PROVIDER_TRANSIENT,
  ].includes(errorClass);

  if (retryableSameCredential && hasAttemptBudget(state, policy)) {
    if (state.same_credential_retries < policy.limits.max_same_credential_retries) {
      return {
        ...base,
        action: ACTION.RETRY_SAME_CREDENTIAL,
        delay_ms: computeBackoffMs(state.same_credential_retries, policy, random),
        circuit_update: transientCircuitUpdate(state, policy, nowMs),
      };
    }

    if (errorClass === ERROR_CLASS.REQUEST_CONFLICT) {
      return { ...base, action: ACTION.STOP_NON_RETRIABLE };
    }

    const alternate = fallbackCredential(state, policy, health, nowMs);
    if (alternate) {
      return {
        ...base,
        action: ACTION.FAILOVER_CREDENTIAL,
        next_credential_alias: alternate.alias,
        delay_ms: computeBackoffMs(state.same_credential_retries, policy, random),
        circuit_update: transientCircuitUpdate(state, policy, nowMs),
      };
    }
  }

  return { ...base, action: ACTION.STOP_BUDGET_EXHAUSTED };
}

module.exports = {
  ACTION,
  ERROR_CLASS,
  classifyProviderOutcome,
  computeBackoffMs,
  isCircuitOpen,
  nextProviderAction,
  selectCredential,
};
