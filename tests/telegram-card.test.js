const fs = require('node:fs');
const path = require('node:path');

const cardCode = fs.readFileSync(
  path.join(__dirname, '..', 'n8n', 'code', 'telegram-vacancy-card.js'),
  'utf8',
);
const deliveryCode = fs.readFileSync(
  path.join(__dirname, '..', 'n8n', 'code', 'mark-delivery-result.js'),
  'utf8',
);

const runCardNode = new Function('$input', cardCode);
const runDeliveryNode = new Function('$input', '$getWorkflowStaticData', '$', deliveryCode);
let checks = 0;

function assert(condition, message) {
  checks += 1;
  if (!condition) throw new Error(message);
}

function vacancy(overrides = {}) {
  return {
    vacancy_key: 'habr:42',
    title: 'Junior <AI> Engineer',
    company: 'A&B',
    url: 'https://example.test/vacancy?id=42&from=mark',
    work_format: 'remote',
    location: 'Tbilisi & Remote',
    salary_specified: true,
    salary_formatted: '100 000–150 000 ₽',
    predicted_salary_available: true,
    predicted_salary_formatted: '180 000 ₽',
    ai_assessment: {
      score: 81,
      level: 'JUNIOR',
      decision: 'APPLY',
      reasons: ['Подходит Python & LLM'],
      gaps: ['Нет <production> опыта'],
      summary: 'Стоит откликнуться.',
    },
    ...overrides,
  };
}

function card(value = vacancy()) {
  return runCardNode({ item: { json: value } }).json;
}

const rendered = card();
assert(rendered.telegram_delivery_ready === true, 'Valid card must be delivery-ready');
assert(rendered.telegram_parse_mode === 'HTML', 'Telegram mode must be HTML');
assert(rendered.telegram_text.includes('Junior &lt;AI&gt; Engineer'), 'Title must be HTML escaped');
assert(rendered.telegram_text.includes('A&amp;B'), 'Company must be HTML escaped');
assert(rendered.telegram_text.includes('Зарплата работодателя:'), 'Employer salary must be explicit');
assert(rendered.telegram_text.includes('Прогноз Habr (не оффер):'), 'Predicted salary must be labelled separately');
assert(rendered.telegram_text.length < 4096, 'Telegram card must stay under platform limit');

const missingSalary = card({
  ...vacancy(),
  salary_specified: false,
  salary_formatted: null,
  predicted_salary_available: false,
  predicted_salary_formatted: null,
});
assert(missingSalary.telegram_text.includes('Зарплата работодателя:</b> не указана'), 'Missing salary must be allowed');
assert(!missingSalary.telegram_text.includes('Прогноз Habr (не оффер):'), 'Missing prediction must not create a fake salary');

const longCard = card({
  ...vacancy(),
  ai_assessment: {
    ...vacancy().ai_assessment,
    summary: 'Очень длинный итог. '.repeat(500),
  },
});
assert(longCard.telegram_text.length <= 3901, 'Long Telegram card must be bounded');

function delivery({ response, base, state }) {
  const dollar = (name) => name === 'Build Telegram Vacancy Card'
    ? { item: { json: base }, isExecuted: true }
    : { isExecuted: false };
  return runDeliveryNode(
    { item: { json: response } },
    () => state,
    dollar,
  ).json;
}

const deliveryState = {
  mark_job_hunter: {
    current_run_id: 'run-1',
    runs: { 'run-1': { telegram_sent_count: 0 } },
    vacancies: {
      'habr:42': { vacancy_key: 'habr:42', telegram_sent: false, delivery_required: true },
    },
    errors: [],
  },
};
const delivered = delivery({ response: { message_id: 777 }, base: rendered, state: deliveryState });
assert(delivered.telegram_delivery_success === true, 'Telegram success must be detected');
assert(deliveryState.mark_job_hunter.vacancies['habr:42'].telegram_sent === true, 'Telegram success must persist');
assert(deliveryState.mark_job_hunter.runs['run-1'].telegram_sent_count === 1, 'Telegram success must update metrics');

const errorState = {
  mark_job_hunter: {
    vacancies: { 'habr:42': { vacancy_key: 'habr:42', telegram_sent: false } },
    errors: [],
    runs: {},
  },
};
const failed = delivery({ response: { error: { message: 'chat not found' } }, base: rendered, state: errorState });
assert(failed.telegram_delivery_success === false, 'Telegram error must be detected');
assert(errorState.mark_job_hunter.vacancies['habr:42'].telegram_sent === false, 'Failed delivery must remain pending');
assert(errorState.mark_job_hunter.errors.length === 1, 'Failed delivery must be logged');

const serialized = [cardCode, deliveryCode, rendered.telegram_text].join('\n');
assert(!/\b\d{8,12}\b/.test(serialized), 'Telegram implementation must not contain a literal Chat ID');

console.log(`PASS: ${checks} Telegram card checks`);
