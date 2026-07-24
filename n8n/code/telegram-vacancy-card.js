/**
 * MARK — Telegram Vacancy Card
 * Version: 1.0.0
 * n8n Code node mode: Run Once for Each Item
 */

const CARD_VERSION = '1.0.0';
const MAX_MESSAGE_LENGTH = 3900;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function list(values, emptyText = 'нет') {
  const clean = Array.isArray(values) ? values.map((value) => String(value).trim()).filter(Boolean) : [];
  return clean.length > 0
    ? clean.slice(0, 6).map((value) => `• ${escapeHtml(value)}`).join('\n')
    : emptyText;
}

const inputItem = $input.item;
const vacancy = inputItem?.json ?? {};
const assessment = vacancy.ai_assessment ?? {};
const employerSalary = vacancy.salary_specified === true && vacancy.salary_formatted
  ? vacancy.salary_formatted
  : 'не указана';
const predictedSalary = vacancy.predicted_salary_available === true && vacancy.predicted_salary_formatted
  ? vacancy.predicted_salary_formatted
  : null;
const location = vacancy.location || [vacancy.city, vacancy.country].filter(Boolean).join(', ') || 'не указана';
const format = vacancy.work_format || 'unknown';
const title = vacancy.title || 'Без названия';
const company = vacancy.company || 'Компания не указана';
const url = vacancy.url || '';

const lines = [
  `<b>${escapeHtml(title)}</b>`,
  escapeHtml(company),
  '',
  `<b>AI fit:</b> ${escapeHtml(assessment.score ?? '?')}/100 · ${escapeHtml(assessment.decision ?? 'REVIEW')}`,
  `<b>Уровень:</b> ${escapeHtml(assessment.level ?? vacancy.level_decision ?? 'UNKNOWN')}`,
  `<b>Формат:</b> ${escapeHtml(format)}`,
  `<b>Локация:</b> ${escapeHtml(location)}`,
  `<b>Зарплата работодателя:</b> ${escapeHtml(employerSalary)}`,
];

if (predictedSalary) {
  lines.push(`<b>Прогноз Habr (не оффер):</b> ${escapeHtml(predictedSalary)}`);
}

lines.push(
  '',
  '<b>Почему подходит:</b>',
  list(assessment.reasons),
  '',
  '<b>Пробелы:</b>',
  list(assessment.gaps),
  '',
  `<b>Итог:</b> ${escapeHtml(assessment.summary || 'Нужна ручная проверка.')}`,
);

if (url) {
  lines.push('', `<a href="${escapeHtml(url)}">Открыть вакансию</a>`);
}

let message = lines.join('\n');
if (message.length > MAX_MESSAGE_LENGTH) {
  const suffix = url ? `\n\n<a href="${escapeHtml(url)}">Открыть вакансию</a>` : '';
  message = `${message.slice(0, MAX_MESSAGE_LENGTH - suffix.length - 20)}…${suffix}`;
}

return {
  ...inputItem,
  json: {
    ...vacancy,
    telegram_card_version: CARD_VERSION,
    telegram_parse_mode: 'HTML',
    telegram_text: message,
    telegram_delivery_ready: Boolean(vacancy.vacancy_key && assessment.score != null && message),
  },
};
