const fs = require('node:fs');
const path = require('node:path');

const requestCode = fs.readFileSync(
  path.join(__dirname, '..', 'n8n', 'code', 'nvidia-scoring-request.js'),
  'utf8',
);
const responseCode = fs.readFileSync(
  path.join(__dirname, '..', 'n8n', 'code', 'nvidia-scoring-response.js'),
  'utf8',
);

const runRequestNode = new Function('$input', '$getWorkflowStaticData', requestCode);
const runResponseNode = new Function('$input', '$getWorkflowStaticData', '$', responseCode);
let checks = 0;

function assert(condition, message) {
  checks += 1;
  if (!condition) throw new Error(message);
}

function baseVacancy(overrides = {}) {
  return {
    vacancy_key: 'habr:123',
    source: 'habr',
    source_id: '123',
    title: 'Junior AI Engineer',
    company: 'Example & Co',
    url: 'https://career.habr.com/vacancies/123',
    work_format: 'remote',
    location: 'Remote',
    skills: ['Python', 'LLM API'],
    description: 'Build LLM integrations and automation.',
    salary_specified: true,
    salary_formatted: '100 000–150 000 ₽',
    predicted_salary_available: true,
    predicted_salary_formatted: '180 000 ₽',
    level_decision: 'PASS',
    level_filter_reasons: ['Junior role'],
    hard_filter_reasons: ['Remote allowed'],
    vacancy_state_action: 'score',
    should_continue_to_nvidia_scorer: true,
    candidate_profile_version: '1.2.0',
    candidate_profile_for_scorer: {
      schema: 'mark.candidate_for_scorer.v1',
      profile_version: '1.2.0',
      skills: [{ name: 'Python', level: 'project_applied' }],
      gaps: [{ name: 'Production deployment experience', level: 'not_proven' }],
      truth: { commercial_ai_experience: false },
    },
    candidate_profile: { must_not_be_sent: 'full_only_secret' },
    ...overrides,
  };
}

function makeState() {
  return {
    mark_job_hunter: {
      current_run_id: 'run-1',
      scheduler: { mode: 'fixed_interval', interval_minutes: 10 },
      runs: { 'run-1': { ai_candidates_count: 0, ai_scored_count: 0, provider_errors_count: 0 } },
      vacancies: {
        'habr:123': { vacancy_key: 'habr:123', scoring_status: 'pending', telegram_sent: false },
      },
      provider_health: {},
      errors: [],
    },
  };
}

function runRequest(vacancy = baseVacancy(), state = makeState()) {
  const result = runRequestNode(
    { item: { json: vacancy } },
    () => state,
  );
  return { result: result.json, state };
}

function assessment(overrides = {}) {
  return {
    schema: 'mark.ai_assessment.v1',
    score: 82,
    level: 'JUNIOR',
    decision: 'APPLY',
    reasons: ['Есть релевантный проектный опыт'],
    gaps: ['Нет подтверждённого production deployment'],
    summary: 'Хорошее совпадение для junior-позиции.',
    salary_used_in_score: false,
    ...overrides,
  };
}

function runResponse({
  builder,
  state,
  routeNode = 'NVIDIA Scorer — Primary',
  statusCode = 200,
  body = { choices: [{ message: { content: JSON.stringify(assessment()) } }] },
  headers = {},
  error,
  upstreamResults = {},
}) {
  const nodeMap = {
    'Build NVIDIA Scoring Request': { item: { json: builder }, isExecuted: true },
    [routeNode]: { isExecuted: true },
    ...Object.fromEntries(
      Object.entries(upstreamResults).map(([name, json]) => [name, { item: { json }, isExecuted: true }]),
    ),
  };
  const dollar = (name) => nodeMap[name] ?? { isExecuted: false };
  return runResponseNode(
    { item: { json: error ? { error, headers } : { statusCode, body, headers } } },
    () => state,
    dollar,
  ).json;
}

const primary = runRequest();
assert(primary.result.scorer_request_valid === true, 'Valid scorer request must pass');
assert(primary.result.provider_route === 'primary', 'Healthy provider must use primary');
assert(primary.result.nvidia_attempt_count === 0, 'Request builder must start before the first attempt');
assert(primary.result.nvidia_fallback_used === false, 'Healthy primary route must not report fallback');
assert(primary.result.scorer_prompt_version === '1.0.0', 'Prompt version must be stored');
assert(primary.result.scorer_version === '1.1.0', 'Scorer version must be stored');
assert(primary.result.nvidia_request_body.model === 'nvidia/nemotron-3-super-120b-a12b', 'Primary model mismatch');
assert(primary.result.nvidia_fallback_request_body.model === 'nvidia/nemotron-3-nano-30b-a3b', 'Fallback model mismatch');
assert(primary.result.nvidia_fallback_request_body.temperature === 0.1, 'Nano fallback temperature must match its tested profile');
assert(primary.result.nvidia_fallback_request_body.top_p === 1, 'Nano fallback top-p must match its tested profile');
assert(primary.result.nvidia_request_body.guided_json.additionalProperties === false, 'Scorer must use strict guided JSON');
assert(primary.result.nvidia_request_body.guided_json.required.includes('salary_used_in_score'), 'Guided JSON must enforce salary policy');
assert(primary.state.mark_job_hunter.runs['run-1'].ai_candidates_count === 1, 'Actual scorer candidate must be counted');
assert(primary.state.mark_job_hunter.scheduler.interval_minutes === 10, 'Scoring must not mutate fixed schedule state');

const serializedRequest = JSON.stringify(primary.result.nvidia_request_body);
assert(!serializedRequest.includes('salary_formatted'), 'Employer salary must not enter scorer request');
assert(!serializedRequest.includes('predicted_salary'), 'Predicted salary must not enter scorer request');
assert(!serializedRequest.includes('full_only_secret'), 'Full audit profile must not enter scorer request');
assert(serializedRequest.includes('mark.candidate_for_scorer.v1'), 'Compact candidate profile must enter scorer request');

const openState = makeState();
openState.mark_job_hunter.provider_health.nvidia_primary = {
  status: 'open',
  requires_manual_reset: true,
};
assert(runRequest(baseVacancy(), openState).result.provider_route === 'secondary', 'Open primary circuit must route to secondary');

const success = runResponse({ builder: primary.result, state: primary.state });
assert(success.nvidia_result_valid === true, 'Valid NVIDIA response must pass');
assert(success.ai_assessment.score === 82, 'Score must be preserved');
assert(success.ai_assessment.decision === 'APPLY', 'Decision must be APPLY');
assert(success.delivery_required === true, 'Score above threshold must require delivery');
assert(success.ai_assessment.candidate_profile_version === '1.2.0', 'Profile version must be persisted');
assert(success.ai_assessment.attempt_count === 1, 'Primary success must record one attempt');
assert(success.ai_assessment.fallback_used === false, 'Primary success must not report fallback');
assert(primary.state.mark_job_hunter.vacancies['habr:123'].scoring_status === 'completed', 'Successful score must persist');
assert(primary.state.mark_job_hunter.runs['run-1'].ai_scored_count === 1, 'Successful score must update run metrics');

const fencedState = makeState();
const fencedBuilder = runRequest(baseVacancy(), fencedState).result;
const fenced = runResponse({
  builder: fencedBuilder,
  state: fencedState,
  body: { choices: [{ message: { content: `\`\`\`json\n${JSON.stringify(assessment({ score: 70, decision: 'APPLY' }))}\n\`\`\`` } }] },
});
assert(fenced.nvidia_result_valid === true, 'Fenced JSON must be repaired');
assert(fenced.nvidia_response_repaired === true, 'Repair flag must be true');
assert(fenced.ai_assessment.decision === 'REVIEW', 'Threshold must deterministically adjust decision');
assert(fenced.ai_assessment.decision_adjusted === true, 'Adjusted decision must be explained');

const authState = makeState();
const authBuilder = runRequest(baseVacancy(), authState).result;
const auth = runResponse({ builder: authBuilder, state: authState, statusCode: 401, body: { error: 'unauthorized' } });
assert(auth.should_failover_credential === true, '401 must fail over credential');
assert(auth.nvidia_attempt_count === 1, 'Primary 401 must count the failed attempt');
assert(auth.nvidia_fallback_reason === 'authentication_error', '401 must preserve its failover reason');
assert(authState.mark_job_hunter.provider_health.nvidia_primary.requires_manual_reset === true, '401 must open primary circuit');

const secondarySuccess = runResponse({
  builder: authBuilder,
  state: authState,
  routeNode: 'NVIDIA Scorer — Secondary',
  upstreamResults: { 'Parse NVIDIA Result — Primary': auth },
});
assert(secondarySuccess.nvidia_result_valid === true, 'Secondary success after 401 must pass');
assert(secondarySuccess.nvidia_attempt_count === 2, 'Secondary success must retain both attempts');
assert(secondarySuccess.nvidia_fallback_used === true, 'Secondary success must report fallback');
assert(secondarySuccess.nvidia_fallback_reason === 'authentication_error', 'Final score must retain original failure reason');
assert(secondarySuccess.nvidia_used_credential_aliases.join(',') === 'nvidia_primary,nvidia_secondary', 'Final score must retain both credential aliases');

const wrappedState = makeState();
const wrappedBuilder = runRequest(baseVacancy(), wrappedState).result;
const wrapped = runResponse({
  builder: wrappedBuilder,
  state: wrappedState,
  statusCode: 500,
  body: { message: 'Missing request extension: Authorization<Bearer> was not found' },
});
assert(wrapped.nvidia_error_class === 'authentication_error', 'Wrapped missing authorization must classify as auth');
assert(wrapped.should_failover_credential === true, 'Wrapped auth error must fail over');

const rateLimitState = makeState();
const rateLimitBuilder = runRequest(baseVacancy(), rateLimitState).result;
const rateLimit = runResponse({
  builder: rateLimitBuilder,
  state: rateLimitState,
  statusCode: 429,
  body: { error: 'too many requests' },
  headers: { 'retry-after': '7' },
});
assert(rateLimit.nvidia_error_class === 'rate_limit', '429 must classify as rate limit');
assert(rateLimit.should_failover_credential === true, '429 must fail over credential');
assert(rateLimit.nvidia_retry_after_ms === 7000, '429 must honor Retry-After seconds');

const timeoutState = makeState();
const timeoutBuilder = runRequest(baseVacancy(), timeoutState).result;
const timeout = runResponse({
  builder: timeoutBuilder,
  state: timeoutState,
  error: { message: 'Request timed out', code: 'ETIMEDOUT' },
});
assert(timeout.nvidia_error_class === 'request_timeout', 'Timeout must classify distinctly');
assert(timeout.should_failover_credential === true, 'Timeout must fail over credential');

const transientState = makeState();
const transientBuilder = runRequest(baseVacancy(), transientState).result;
const transient = runResponse({
  builder: transientBuilder,
  state: transientState,
  statusCode: 503,
  body: { error: 'service unavailable' },
});
assert(transient.nvidia_error_class === 'provider_transient', '503 must classify as transient');
assert(transient.should_failover_credential === true, '503 must fail over credential');

const missingModelState = makeState();
const missingModelBuilder = runRequest(baseVacancy(), missingModelState).result;
const missingModel = runResponse({ builder: missingModelBuilder, state: missingModelState, statusCode: 404, body: {} });
assert(missingModel.should_model_fallback === true, '404 must use model fallback');

const brokenState = makeState();
const brokenBuilder = runRequest(baseVacancy(), brokenState).result;
const broken = runResponse({
  builder: brokenBuilder,
  state: brokenState,
  body: { choices: [{ message: { content: 'not json' } }] },
});
assert(broken.nvidia_error_class === 'contract_failure', 'Broken JSON must be a contract failure');
assert(broken.should_model_fallback === true, 'Broken primary contract must use Nano fallback');

const nanoBrokenState = makeState();
const nanoBuilder = runRequest(baseVacancy(), nanoBrokenState).result;
const nanoBroken = runResponse({
  builder: nanoBuilder,
  state: nanoBrokenState,
  routeNode: 'NVIDIA Scorer — Nano Primary',
  body: { choices: [{ message: { content: '{broken' } }] },
});
assert(nanoBroken.should_model_fallback === false, 'Broken Nano response must not loop models');
assert(nanoBrokenState.mark_job_hunter.vacancies['habr:123'].scoring_status === 'error', 'Terminal contract failure must persist for retry');

const nanoAuthState = makeState();
const nanoAuthBuilder = runRequest(baseVacancy(), nanoAuthState).result;
const nanoAuth = runResponse({
  builder: nanoAuthBuilder,
  state: nanoAuthState,
  routeNode: 'NVIDIA Scorer — Nano Primary',
  statusCode: 401,
  body: { error: 'unauthorized' },
});
assert(nanoAuth.should_failover_credential === true, 'Nano primary 401 must fail over to Nano secondary');

const salaryViolationState = makeState();
const salaryViolationBuilder = runRequest(baseVacancy(), salaryViolationState).result;
const salaryViolation = runResponse({
  builder: salaryViolationBuilder,
  state: salaryViolationState,
  body: { choices: [{ message: { content: JSON.stringify(assessment({ salary_used_in_score: true })) } }] },
});
assert(salaryViolation.nvidia_contract_errors.includes('assessment_salary_policy_missing'), 'Salary policy violation must invalidate contract');

console.log(`PASS: ${checks} NVIDIA scorer checks`);
