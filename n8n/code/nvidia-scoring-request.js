/**
 * MARK — Build NVIDIA Scoring Request
 * Version: 1.2.0
 * n8n Code node mode: Run Once for Each Item
 *
 * Builds a compact vacancy + candidate prompt. Employer and predicted salary
 * are intentionally omitted so salary cannot affect semantic fit.
 */

const REQUEST_SCHEMA = 'mark.nvidia_scoring_request.v1';
const SCORER_SCHEMA = 'mark.ai_assessment.v1';
const SCORER_PROMPT_VERSION = '1.0.0';
const SCORER_VERSION = '1.1.0';
const PRIMARY_MODEL = 'nvidia/nemotron-3-super-120b-a12b';
const FALLBACK_MODEL = 'nvidia/nemotron-3-nano-30b-a3b';
const MAX_DESCRIPTION_CHARS = 12000;
const GUIDED_JSON_SCHEMA = {
  type: 'object',
  properties: {
    schema: { type: 'string', enum: [SCORER_SCHEMA] },
    score: { type: 'integer', minimum: 0, maximum: 100 },
    level: { type: 'string', enum: ['INTERN', 'JUNIOR', 'JUNIOR_PLUS', 'MIDDLE', 'MIDDLE_PLUS', 'UNKNOWN'] },
    decision: { type: 'string', enum: ['APPLY', 'REVIEW', 'SKIP'] },
    reasons: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 6 },
    gaps: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    summary: { type: 'string', minLength: 1, maxLength: 800 },
    salary_used_in_score: { type: 'boolean', enum: [false] },
  },
  required: ['schema', 'score', 'level', 'decision', 'reasons', 'gaps', 'summary', 'salary_used_in_score'],
  additionalProperties: false,
};

const inputItem = $input.item;
const vacancy = inputItem?.json ?? {};
const profile = vacancy.candidate_profile_for_scorer;

const errors = [];
if (vacancy.vacancy_state_action !== 'score') errors.push('vacancy_state_action_not_score');
if (vacancy.should_continue_to_nvidia_scorer !== true) errors.push('candidate_profile_gate_closed');
if (!vacancy.vacancy_key) errors.push('vacancy_key_missing');
if (!profile || profile.schema !== 'mark.candidate_for_scorer.v1') errors.push('candidate_scorer_profile_missing');

const compactVacancy = {
  vacancy_key: vacancy.vacancy_key ?? null,
  source: vacancy.source ?? null,
  title: vacancy.title ?? null,
  company: vacancy.company ?? null,
  url: vacancy.url ?? null,
  work_format: vacancy.work_format ?? 'unknown',
  location: vacancy.location ?? null,
  country: vacancy.country ?? null,
  city: vacancy.city ?? null,
  employment: vacancy.employment ?? null,
  qualification: vacancy.qualification ?? null,
  skills: Array.isArray(vacancy.skills) ? vacancy.skills.slice(0, 80) : [],
  required_experience_min_years: vacancy.required_experience_min_years ?? null,
  required_experience_max_years: vacancy.required_experience_max_years ?? null,
  deterministic_level_decision: vacancy.level_decision ?? null,
  deterministic_level_reasons: Array.isArray(vacancy.level_filter_reasons)
    ? vacancy.level_filter_reasons.slice(0, 12)
    : [],
  deterministic_hard_filter_reasons: Array.isArray(vacancy.hard_filter_reasons)
    ? vacancy.hard_filter_reasons.slice(0, 12)
    : [],
  description: String(vacancy.description ?? '').slice(0, MAX_DESCRIPTION_CHARS),
};

const systemPrompt = [
  'You are MARK vacancy fit scorer.',
  'Use only the supplied candidate evidence and vacancy text.',
  'Personal projects are not commercial or production employment.',
  'Do not invent skills, experience, education, English level, or work authorization.',
  'Treat learnable technical gaps separately from hard experience barriers.',
  'Salary is excluded from the input and must not affect the score.',
  'Respect deterministic filters already applied upstream.',
  'Return one JSON object only, without markdown or commentary.',
  `Required schema: {"schema":"${SCORER_SCHEMA}","score":0-100 integer,"level":"INTERN|JUNIOR|JUNIOR_PLUS|MIDDLE|MIDDLE_PLUS|UNKNOWN","decision":"APPLY|REVIEW|SKIP","reasons":[1-6 concise Russian strings],"gaps":[0-6 concise Russian strings],"summary":"concise Russian summary","salary_used_in_score":false}.`,
  'Score guidance: 75-100 APPLY, 65-74 REVIEW, 0-64 SKIP.',
].join('\n');

const userPayload = {
  request_schema: REQUEST_SCHEMA,
  scorer_prompt_version: SCORER_PROMPT_VERSION,
  scorer_version: SCORER_VERSION,
  candidate_profile_version: vacancy.candidate_profile_version ?? profile?.profile_version ?? null,
  candidate: profile ?? null,
  vacancy: compactVacancy,
};

const baseBody = {
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: JSON.stringify(userPayload) },
  ],
  max_tokens: 700,
  temperature: 1,
  top_p: 0.95,
  stream: false,
  guided_json: GUIDED_JSON_SCHEMA,
};

const staticData = $getWorkflowStaticData('global');
const root = staticData.mark_job_hunter ?? (staticData.mark_job_hunter = {});
root.provider_health ??= {};
root.runs ??= {};

const now = Date.now();
const primaryHealth = root.provider_health.nvidia_primary ?? {};
const primaryOpen = primaryHealth.requires_manual_reset === true ||
  (primaryHealth.status === 'open' && Number(primaryHealth.circuit_open_until_ms ?? 0) > now);
const providerRoute = primaryOpen ? 'secondary' : 'primary';

const run = root.current_run_id ? root.runs[root.current_run_id] : null;
if (run && errors.length === 0) {
  run.ai_candidates_count = Number(run.ai_candidates_count ?? 0) + 1;
  run.last_ai_candidate_at = new Date(now).toISOString();
}

const requestId = `${String(vacancy.vacancy_key ?? 'unknown').replace(/[^a-zA-Z0-9:_-]/g, '_')}:${now}`;

return {
  ...inputItem,
  json: {
    ...vacancy,
    nvidia_request_schema: REQUEST_SCHEMA,
    scorer_schema: SCORER_SCHEMA,
    scorer_prompt_version: SCORER_PROMPT_VERSION,
    scorer_version: SCORER_VERSION,
    scorer_request_id: requestId,
    scorer_request_errors: errors,
    scorer_request_valid: errors.length === 0,
    provider_route: providerRoute,
    nvidia_attempt_count: 0,
    nvidia_used_credential_aliases: [],
    nvidia_fallback_used: providerRoute === 'secondary',
    nvidia_fallback_reason: providerRoute === 'secondary' ? 'primary_circuit_open' : null,
    nvidia_fallback_reasons: providerRoute === 'secondary' ? ['primary_circuit_open'] : [],
    nvidia_request_body: {
      ...baseBody,
      model: PRIMARY_MODEL,
      reasoning_effort: 'none',
    },
    nvidia_fallback_request_body: {
      ...baseBody,
      model: FALLBACK_MODEL,
      temperature: 0.1,
      top_p: 1,
      chat_template_kwargs: { enable_thinking: false },
    },
  },
};
