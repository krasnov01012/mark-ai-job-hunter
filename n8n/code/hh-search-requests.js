/**
 * MARK — HeadHunter Search Requests
 * Version: 1.1.0
 * n8n Code node mode: Run Once for All Items
 *
 * Builds two bounded searches:
 *   1. remote AI vacancies on hh.ru;
 *   2. all AI vacancies in Tbilisi on headhunter.ge.
 *
 * HH's `moreThan6` category is excluded server-side because it is always
 * outside MARK's accepted experience policy. The mixed `between3And6`
 * category stays in retrieval for downstream 3–4 vs confirmed 5+ analysis.
 * Salary is intentionally absent from the query.
 */

const HH_SEARCH_QUERY_VERSION = '1.1.0';
const HH_API_BASE_URL = 'https://api.hh.ru/vacancies';
const HH_ALLOWED_EXPERIENCE = [
  'noExperience',
  'between1And3',
  'between3And6',
];
const HH_TEXT_QUERY = [
  '"AI Engineer"',
  '"LLM Engineer"',
  '"ML Engineer"',
  '"Machine Learning Engineer"',
  '"AI Developer"',
  '"Data Scientist"',
  '"Prompt Engineer"',
  '"ИИ инженер"',
  '"ML разработчик"',
  'RAG',
].join(' OR ');

function searchUrl({ scope, host, area = null, workFormat = null }) {
  // n8n's Code-node sandbox does not expose the Web API URLSearchParams.
  // Build the query from ECMAScript globals that are available there.
  const parameters = {
    text: HH_TEXT_QUERY,
    per_page: '100',
    page: '0',
    period: '1',
    order_by: 'publication_time',
    no_magic: 'true',
    experience: HH_ALLOWED_EXPERIENCE,
    host,
    locale: 'RU',
    ...(area ? { area } : {}),
    ...(workFormat ? { work_format: workFormat } : {}),
  };
  const query = Object.entries(parameters)
    .flatMap(([key, value]) => (Array.isArray(value) ? value : [value])
      .map((item) => `${encodeURIComponent(key)}=${encodeURIComponent(item)}`))
    .join('&');

  return {
    json: {
      source: 'headhunter',
      hh_search_query_version: HH_SEARCH_QUERY_VERSION,
      hh_search_scope: scope,
      hh_search_url: `${HH_API_BASE_URL}?${query}`,
      salary_filter_applied: false,
    },
  };
}

return [
  searchUrl({
    scope: 'remote',
    host: 'hh.ru',
    workFormat: 'REMOTE',
  }),
  searchUrl({
    scope: 'tbilisi',
    host: 'headhunter.ge',
    area: '2758',
  }),
];
