const fs = require('node:fs');
const path = require('node:path');

const code = fs.readFileSync(
  path.join(__dirname, '..', 'n8n', 'code', 'habr-level-filter.js'),
  'utf8',
);

const runNode = new Function('$input', code);

const base = {
  hard_filter_decision: 'PASS',
  title: 'AI Engineer',
  description: 'Разрабатывать LLM-системы и RAG-пайплайны.',
  matched_level_categories: [],
  matched_experience_signals: [],
  experience_min_years_hint: null,
  experience_max_years_hint: null,
  seniority_risk_hint: 'low',
};

function run(overrides = {}) {
  return runNode({
    item: {
      json: { ...base, ...overrides },
    },
  }).json;
}

const cases = [
  ['junior', { title: 'Junior AI Engineer' }, 'PASS', 'junior'],
  ['intern', { title: 'AI Engineer Intern' }, 'PASS', 'intern'],
  ['middle', { title: 'Middle AI Engineer' }, 'PASS', 'middle'],
  ['middle plus', { title: 'Middle+ AI Engineer' }, 'STRETCH', 'middle_plus'],
  ['senior', { title: 'Senior AI Engineer' }, 'REJECT', 'senior'],
  ['lead', { title: 'Lead AI Engineer' }, 'REJECT', 'lead'],
  ['principal', { title: 'Principal AI Engineer' }, 'REJECT', 'principal'],
  ['staff', { title: 'Staff AI Engineer' }, 'REJECT', 'staff'],
  ['head', { title: 'Head of AI' }, 'REJECT', 'head'],
  ['architect', { title: 'AI Architect' }, 'REJECT', 'architect'],
  ['five years', { description: 'Требуется опыт работы не менее 5 лет с LLM.' }, 'REJECT', 'senior'],
  ['seven years english', { description: 'At least 7 years of experience building AI systems.' }, 'REJECT', 'senior'],
  ['three years', { description: 'Опыт разработки LLM от 3 лет.' }, 'STRETCH', 'middle'],
  ['four years words', { description: 'Опыт разработки AI не менее четырех лет.' }, 'STRETCH', 'middle_plus'],
  ['two years', { description: 'Опыт работы с Python от 2 лет.' }, 'STRETCH', 'junior_plus'],
  ['one year', { description: 'Опыт работы с LLM от 1 года.' }, 'PASS', 'junior'],
  ['unknown level', {}, 'STRETCH', 'unknown'],
  ['senior mentioned as colleague', { description: 'Работать в команде с senior engineers над LLM.' }, 'STRETCH', 'unknown'],
  ['unconfirmed RSS senior hint', { matched_level_categories: ['SENIOR'], seniority_risk_hint: 'high' }, 'STRETCH', 'unknown'],
  ['salary ignored', { salary_from: 1, salary_to: 1 }, 'STRETCH', 'unknown'],
];

let failures = 0;

for (const [name, overrides, expectedDecision, expectedLevel] of cases) {
  const output = run(overrides);
  const passed =
    output.level_filter_decision === expectedDecision &&
    output.inferred_level === expectedLevel &&
    output.should_continue_to_candidate_profile ===
      (expectedDecision === 'PASS' || expectedDecision === 'STRETCH') &&
    output.seniority_filter_applied === true;

  if (!passed) {
    failures += 1;
    console.error('FAIL', name, {
      expectedDecision,
      expectedLevel,
      actualDecision: output.level_filter_decision,
      actualLevel: output.inferred_level,
      code: output.level_filter_code,
      minYears: output.required_experience_min_years,
      signals: output.matched_full_page_experience_signals,
    });
  }
}

if (failures > 0) {
  process.exitCode = 1;
} else {
  console.log(`PASS: ${cases.length} level-filter scenarios`);
}
