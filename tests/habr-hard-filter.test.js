const fs = require('node:fs');
const path = require('node:path');

const code = fs.readFileSync(
  path.join(__dirname, '..', 'n8n', 'code', 'habr-hard-filter.js'),
  'utf8',
);

const runNode = new Function('$input', code);

const base = {
  normalization_ok: true,
  normalization_errors: [],
  source: 'habr_career',
  source_id: '1000000001',
  vacancy_key: 'habr:1000000001',
  url: 'https://career.habr.com/vacancies/1000000001',
  title: 'AI Engineer',
  description: 'Разрабатывать LLM-системы и RAG-пайплайны на Python.',
  skills: ['Python', 'LLM', 'RAG'],
  archived: false,
  hidden: false,
  status: 'active',
  work_format: 'remote',
  work_format_confidence: 'high',
  work_format_conflict: false,
  remote_denied: false,
  remote_geo_eligibility: 'confirmed',
  remote_geo_evidence: ['test_confirms_work_from_georgia'],
  city: 'Москва',
  country: 'Russia',
  is_tbilisi: false,
  is_georgia: false,
  prefilter_decision: 'PASS',
  title_role_class: 'target',
  target_role_tier: 'A',
  matched_target_roles: ['AI Engineer'],
  matched_adjacent_roles: [],
  matched_absolute_off_target_roles: [],
  matched_soft_off_target_roles: [],
  matched_stack_off_target_roles: [],
  matched_core_ai_work_signals: ['Develop AI systems'],
  matched_substantive_ai_categories: ['LLM', 'RAG'],
  matched_ai_implementation_signals: ['RAG'],
};

function run(overrides = {}) {
  return runNode({
    item: {
      json: { ...base, ...overrides },
    },
  }).json;
}

const cases = [
  ['remote confirmed from Georgia', {}, 'PASS', 'allow_remote_from_georgia'],
  ['remote confirmed without location field', { city: null, country: null }, 'PASS', 'allow_remote_from_georgia'],
  ['hybrid Tbilisi', { work_format: 'hybrid', city: 'Tbilisi', country: 'Georgia', is_tbilisi: true, is_georgia: true }, 'PASS', 'allow_hybrid_tbilisi'],
  ['office Tbilisi', { work_format: 'office', city: 'Tbilisi', country: 'Georgia', is_tbilisi: true, is_georgia: true }, 'PASS', 'allow_office_tbilisi'],
  ['hybrid Moscow', { work_format: 'hybrid' }, 'REJECT', 'reject_hybrid_outside_tbilisi'],
  ['office Batumi', { work_format: 'office', city: 'Batumi', country: 'Georgia', is_georgia: true }, 'REJECT', 'reject_office_outside_tbilisi'],
  ['unknown format', { work_format: 'unknown' }, 'REVIEW', 'review_work_format_unknown'],
  ['format conflict', { work_format_conflict: true }, 'REVIEW', 'review_work_format_conflict'],
  ['remote denied', { remote_denied: true }, 'REJECT', 'reject_remote_denied'],
  ['HH remote confirmed from Georgia', { source: 'headhunter', remote_geo_eligibility: 'confirmed' }, 'PASS', 'allow_remote_from_georgia'],
  ['HH remote geography unknown', { source: 'headhunter', remote_geo_eligibility: 'unknown' }, 'REVIEW', 'review_remote_geography_unconfirmed'],
  ['HH remote restricted to Russia', { source: 'headhunter', remote_geo_eligibility: 'restricted' }, 'REJECT', 'reject_remote_not_available_from_georgia'],
  ['Habr worldwide fallback', {
    remote_geo_eligibility: null,
    remote_geo_evidence: [],
    description: 'Build LLM systems. Work from anywhere worldwide.',
  }, 'PASS', 'allow_remote_from_georgia'],
  ['Habr unknown geography fallback', {
    remote_geo_eligibility: null,
    remote_geo_evidence: [],
    description: 'Build LLM systems and RAG pipelines.',
  }, 'REVIEW', 'review_remote_geography_unconfirmed'],
  ['Habr Russia-only fallback', {
    remote_geo_eligibility: null,
    remote_geo_evidence: [],
    description: 'Build LLM systems. Работа только на территории РФ.',
  }, 'REJECT', 'reject_remote_not_available_from_georgia'],
  ['normalization failure', { normalization_ok: false }, 'REVIEW', 'review_normalization_failed'],
  ['archived vacancy', { archived: true, status: 'archived' }, 'REJECT', 'reject_vacancy_archived'],
  ['hidden vacancy', { hidden: true, status: 'hidden' }, 'REJECT', 'reject_vacancy_hidden'],
  ['missing salary', { salary_from: null, salary_to: null }, 'PASS', 'allow_remote_from_georgia'],
  ['low salary ignored', { salary_from: 40000, salary_currency: 'RUR' }, 'PASS', 'allow_remote_from_georgia'],
  ['senior handled later', { title: 'Senior AI Engineer', seniority_risk_hint: 'high' }, 'PASS', 'allow_remote_from_georgia'],
  ['absolute off-target role', { title: 'AI Product Manager', matched_absolute_off_target_roles: ['Product Manager'] }, 'REJECT', 'reject_absolute_off_target_role'],
  ['frontend without AI work', {
    title: 'Frontend Developer',
    description: 'Разрабатывать пользовательские интерфейсы.',
    skills: ['JavaScript', 'React'],
    prefilter_decision: 'REVIEW',
    title_role_class: 'off_target',
    matched_target_roles: [],
    matched_core_ai_work_signals: [],
    matched_substantive_ai_categories: [],
    matched_ai_implementation_signals: [],
    matched_stack_off_target_roles: ['Frontend'],
  }, 'REJECT', 'reject_technical_off_target_without_ai_work'],
];

let failures = 0;

for (const [name, overrides, expectedDecision, expectedGateCode] of cases) {
  const output = run(overrides);
  const gateCodes = [
    output.hard_filter_integrity_gate.code,
    output.hard_filter_status_gate.code,
    output.hard_filter_geo_work_gate.code,
    output.hard_filter_role_gate.code,
  ];

  const passed =
    output.hard_filter_decision === expectedDecision &&
    gateCodes.includes(expectedGateCode) &&
    output.hard_filter_role_gate.evidence.implementation_signals.every(
      (signal) => !signal.includes('\\b') && !signal.includes('(?:'),
    ) &&
    (
      expectedDecision !== 'PASS' ||
      output.hard_filter_code === 'allow_all_hard_filter_gates'
    ) &&
    output.salary_filter_applied === false &&
    output.should_continue_to_level_filter === (expectedDecision === 'PASS');

  if (!passed) {
    failures += 1;
    console.error('FAIL', name, {
      expectedDecision,
      expectedGateCode,
      actualDecision: output.hard_filter_decision,
      actualCode: output.hard_filter_code,
      gateCodes,
    });
  }
}

if (failures > 0) {
  process.exitCode = 1;
} else {
  console.log(`PASS: ${cases.length} hard-filter scenarios`);
}
