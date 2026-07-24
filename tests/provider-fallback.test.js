const fs = require('fs');
const path = require('path');

const {
  ACTION,
  ERROR_CLASS,
  classifyProviderOutcome,
  nextProviderAction,
  selectCredential,
} = require('../lib/provider-fallback');

const policyPath = path.resolve(__dirname, '..', 'config', 'providers', 'nvidia.json');
const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
const schemaPath = path.resolve(__dirname, '..', 'config', 'providers', 'schema', 'provider-fallback.schema.json');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
let checks = 0;

function assert(condition, message) {
  checks += 1;
  if (!condition) throw new Error(message);
}

function state(overrides = {}) {
  return {
    attempts_total: 1,
    same_credential_retries: 0,
    credential_failovers: 0,
    response_repairs: 0,
    model_fallbacks: 0,
    current_credential_alias: 'nvidia_primary',
    used_credential_aliases: ['nvidia_primary'],
    ...overrides,
  };
}

function action(outcome, stateOverrides = {}, health = {}) {
  return nextProviderAction({
    outcome,
    state: state(stateOverrides),
    policy,
    health,
    nowMs: 100000,
    random: () => 0.5,
  });
}

assert(policy.schema_version === 'provider.fallback_policy.v1', 'Unexpected provider policy schema');
assert(schema.$id === 'provider.fallback_policy.v1', 'Provider policy schema must match config version');
assert(policy.strategy === 'active_passive', 'Fallback must be active-passive');
assert(policy.credentials.length === 2, 'Exactly two credential aliases are required');
assert(new Set(policy.credentials.map((entry) => entry.alias)).size === 2, 'Credential aliases must be unique');
assert(policy.limits.max_credential_failovers === 1, 'Credential ping-pong must be impossible');
assert(!/nvapi-/i.test(JSON.stringify(policy)), 'Provider policy must not contain an NVIDIA key');
assert(!/[A-Z]:\\/i.test(JSON.stringify(policy)), 'Provider policy must not contain local key paths');

assert(classifyProviderOutcome({ ok: true, status: 200, contractValid: true }) === ERROR_CLASS.SUCCESS, '200 valid response must succeed');
assert(classifyProviderOutcome({ status: 401 }) === ERROR_CLASS.AUTHENTICATION, '401 must be auth error');
assert(classifyProviderOutcome({ status: 403 }) === ERROR_CLASS.PERMISSION, '403 must be permission error');
assert(classifyProviderOutcome({ status: 429 }) === ERROR_CLASS.RATE_LIMIT, '429 must be rate limit');
assert(classifyProviderOutcome({ networkCode: 'ECONNABORTED' }) === ERROR_CLASS.REQUEST_TIMEOUT, 'ECONNABORTED must be timeout');
assert(classifyProviderOutcome({ status: 503 }) === ERROR_CLASS.PROVIDER_TRANSIENT, '503 must be transient');
assert(
  classifyProviderOutcome({
    status: 500,
    body: 'Missing request extension: Authorization<Bearer> was not found',
  }) === ERROR_CLASS.AUTHENTICATION,
  'Provider-wrapped missing Authorization must override a misleading 500 status',
);
assert(classifyProviderOutcome({ status: 400 }) === ERROR_CLASS.BAD_REQUEST, '400 must be bad request');
assert(classifyProviderOutcome({ status: 422 }) === ERROR_CLASS.UNPROCESSABLE_REQUEST, '422 must be unprocessable request');
assert(classifyProviderOutcome({ status: 404 }) === ERROR_CLASS.MODEL_UNAVAILABLE, '404 must be model unavailable');
assert(classifyProviderOutcome({ ok: true, status: 200, contractValid: false }) === ERROR_CLASS.CONTRACT_FAILURE, 'Broken JSON contract must not be a credential error');

assert(action({ ok: true, status: 200, contractValid: true }).action === ACTION.SUCCESS, 'Valid response must finish');

const auth = action({ status: 401 });
assert(auth.action === ACTION.FAILOVER_CREDENTIAL, '401 must fail over immediately');
assert(auth.next_credential_alias === 'nvidia_secondary', '401 must select secondary credential');
assert(auth.circuit_update.requires_manual_reset === true, 'Bad credential must require manual reset');

const wrappedAuth = action({
  status: 500,
  body: 'Missing request extension: Authorization<Bearer> was not found',
});
assert(wrappedAuth.action === ACTION.FAILOVER_CREDENTIAL, 'Missing Authorization wrapped as 500 must fail over');

const limited = action({ status: 429, retryAfterMs: 45000 });
assert(limited.action === ACTION.FAILOVER_CREDENTIAL, '429 should use healthy passive credential');
assert(limited.circuit_update.circuit_open_until_ms === 145000, 'Retry-After must define cooldown');

const limitedNoAlternate = action(
  { status: 429, retryAfterMs: 45000 },
  { credential_failovers: 1, used_credential_aliases: ['nvidia_primary', 'nvidia_secondary'] },
);
assert(limitedNoAlternate.action === ACTION.DEFER_RETRY, '429 without alternate must defer');
assert(limitedNoAlternate.delay_ms === 45000, 'Deferred 429 must respect Retry-After');

const limitedExhausted = action(
  { status: 429, retryAfterMs: 45000 },
  {
    attempts_total: 3,
    credential_failovers: 1,
    current_credential_alias: 'nvidia_secondary',
    used_credential_aliases: ['nvidia_primary', 'nvidia_secondary'],
  },
);
assert(limitedExhausted.action === ACTION.STOP_BUDGET_EXHAUSTED, '429 must not bypass the total attempt budget');

const timeoutFirst = action({ networkCode: 'ECONNABORTED' });
assert(timeoutFirst.action === ACTION.RETRY_SAME_CREDENTIAL, 'First timeout gets one bounded same-key retry');
assert(timeoutFirst.delay_ms === 2000, 'First retry uses deterministic base backoff in test');

const timeoutSecond = action(
  { networkCode: 'ECONNABORTED' },
  { attempts_total: 2, same_credential_retries: 1 },
);
assert(timeoutSecond.action === ACTION.FAILOVER_CREDENTIAL, 'Repeated timeout must fail over');
assert(timeoutSecond.next_credential_alias === 'nvidia_secondary', 'Repeated timeout must select secondary');
assert(timeoutSecond.circuit_update.status === 'open', 'Repeated transient failures must open the circuit');

const conflictFirst = action({ status: 409 });
assert(conflictFirst.action === ACTION.RETRY_SAME_CREDENTIAL, '409 gets one same-credential retry');
const conflictSecond = action({ status: 409 }, { attempts_total: 2, same_credential_retries: 1 });
assert(conflictSecond.action === ACTION.STOP_NON_RETRIABLE, '409 must not consume the secondary credential');

assert(action({ status: 400 }).action === ACTION.STOP_REQUEST_INVALID, '400 must not consume second credential');
assert(action({ status: 422 }).action === ACTION.STOP_REQUEST_INVALID, '422 must not consume second credential');
assert(action({ status: 404 }).action === ACTION.MODEL_FALLBACK, 'Missing model must use model fallback');
assert(action({ ok: true, status: 200, contractValid: false }).action === ACTION.REPAIR_RESPONSE, 'Broken contract gets one repair');
assert(
  action({ ok: true, status: 200, contractValid: false }, { response_repairs: 1 }).action === ACTION.MODEL_FALLBACK,
  'Broken contract after repair must use model fallback',
);

const exhausted = action(
  { status: 503 },
  {
    attempts_total: 3,
    same_credential_retries: 1,
    credential_failovers: 1,
    current_credential_alias: 'nvidia_secondary',
    used_credential_aliases: ['nvidia_primary', 'nvidia_secondary'],
  },
);
assert(exhausted.action === ACTION.STOP_BUDGET_EXHAUSTED, 'Attempt budget must stop retry loops');

const selected = selectCredential(policy.credentials, {
  nvidia_primary: { status: 'open', requires_manual_reset: true },
}, [], 100000);
assert(selected.alias === 'nvidia_secondary', 'Open primary circuit must route to secondary');

const none = selectCredential(policy.credentials, {
  nvidia_primary: { status: 'open', requires_manual_reset: true },
  nvidia_secondary: { status: 'open', circuit_open_until_ms: 200000 },
}, [], 100000);
assert(none === null, 'Both open circuits must stop/defer instead of sending');

console.log(`PASS: ${checks} provider fallback checks`);
