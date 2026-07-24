const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, 'n8n', 'code', name), 'utf8');

const buildRequests = new Function('$input', read('hh-search-requests.js'));
const parseSearch = new Function('$input', read('hh-search-response.js'));
const prefilter = new Function('$input', read('hh-search-prefilter.js'));
const normalize = new Function('$input', '$', read('hh-vacancy-normalizer.js'));
const hardFilter = new Function('$input', read('habr-hard-filter.js'));

const checks = [];
function check(name, condition) {
  checks.push([name, Boolean(condition)]);
}

const requests = buildRequests({ all: () => [{ json: {} }] });
check('two bounded HH search scopes are built', requests.length === 2);
const sandboxBuildRequests = vm.runInNewContext(`(function ($input) {${read('hh-search-requests.js')}\n})`);
const sandboxRequests = sandboxBuildRequests({ all: () => [{ json: {} }] });
check('search builder runs in an n8n-like sandbox without URLSearchParams', sandboxRequests.length === 2);
const urls = requests.map((item) => new URL(item.json.hh_search_url));
check('remote scope uses HH remote format', urls.some((url) => url.searchParams.get('work_format') === 'REMOTE'));
check('Tbilisi scope uses official area id', urls.some((url) => url.searchParams.get('area') === '2758'));
check('search depth is bounded to one day', urls.every((url) => url.searchParams.get('period') === '1'));
check('search returns at most 100 items per scope', urls.every((url) => url.searchParams.get('per_page') === '100'));
check('search reads only the first page of each scope', urls.every((url) => url.searchParams.get('page') === '0'));
check('recall-sensitive role and title-only filters stay downstream', urls.every((url) => !url.searchParams.has('professional_role') && !url.searchParams.has('search_field')));
check('HH experience filter keeps entry through mixed 3–6 buckets', urls.every((url) => JSON.stringify(url.searchParams.getAll('experience')) === JSON.stringify(['noExperience', 'between1And3', 'between3And6'])));
check('HH more-than-six bucket is excluded before retrieval', urls.every((url) => !url.searchParams.getAll('experience').includes('moreThan6')));
check('search query contract version records calibrated filtering', requests.every((item) => item.json.hh_search_query_version === '1.1.0'));
check('salary is absent from HH search filters', urls.every((url) => !url.searchParams.has('salary') && !url.searchParams.has('only_with_salary')));

const searchResponse = (items) => ({
  json: {
    statusCode: 200,
    body: { items },
  },
});
const parsed = parseSearch({
  all: () => [
    searchResponse([
      {
        id: '1001',
        name: 'Junior AI Engineer',
        url: 'https://api.hh.ru/vacancies/1001',
        alternate_url: 'https://hh.ru/vacancy/1001',
        employer: { name: 'Example AI' },
        area: { name: 'Moscow' },
        experience: { id: 'noExperience', name: 'Нет опыта' },
        work_format: [{ id: 'REMOTE' }],
        snippet: { requirement: '<highlighttext>LLM</highlighttext>', responsibility: 'Build RAG systems' },
      },
      {
        id: '1002',
        name: 'Senior AI Engineer',
        url: 'https://api.hh.ru/vacancies/1002',
        alternate_url: 'https://hh.ru/vacancy/1002',
        employer: { name: 'Example Senior' },
        area: { name: 'Tbilisi' },
        experience: { id: 'between3And6', name: 'От 3 до 6 лет' },
        work_format: [{ id: 'HYBRID' }],
        snippet: { requirement: 'Senior', responsibility: 'Build ML systems' },
      },
    ]),
    searchResponse([
      {
        id: '1001',
        name: 'Duplicate',
        url: 'https://api.hh.ru/vacancies/1001',
      },
    ]),
  ],
});
check('duplicate HH IDs collapse within one execution', parsed.length === 2);
check('HH source key uses a source namespace', parsed[0].json.source_state_key === 'hh:1001');
check('search HTML snippets are reduced to text', parsed[0].json.description_snippet === 'LLM Build RAG systems');
check('search parser preserves employer and public URL', parsed[0].json.company === 'Example AI' && parsed[0].json.url.includes('/1001'));

function runPrefilter(json) {
  return prefilter({ item: { json } }).json;
}

const juniorPreview = runPrefilter(parsed.find((item) => item.json.source_id === '1001').json);
const seniorPreview = runPrefilter(parsed.find((item) => item.json.source_id === '1002').json);
check('target Junior AI title passes cheap pre-filter', juniorPreview.prefilter_decision === 'PASS');
check('explicit Senior title is rejected before detail fetch', seniorPreview.prefilter_decision === 'REJECT');
check('prefilter carries HH experience hints', juniorPreview.experience_min_years_hint === 0);
check('prefilter never applies salary', juniorPreview.salary_filter_applied === false);

function runNormalizer(preview, detail, statusCode = 200) {
  const dollar = () => ({ item: { json: preview } });
  return normalize({ item: { json: { statusCode, body: detail } } }, dollar).json;
}

const remoteDetail = {
  id: '1001',
  name: 'Junior AI Engineer',
  alternate_url: 'https://hh.ru/vacancy/1001',
  url: 'https://api.hh.ru/vacancies/1001',
  employer: { name: 'Example AI' },
  area: { name: 'Moscow' },
  description: '<p>Build LLM systems and RAG pipelines.</p><p>Work from anywhere worldwide.</p>',
  key_skills: [{ name: 'Python' }, { name: 'LLM' }, { name: 'RAG' }],
  professional_roles: [{ id: '96', name: 'Software Developer' }],
  experience: { id: 'noExperience', name: 'Нет опыта' },
  work_format: [{ id: 'REMOTE', name: 'Удалённо' }],
  salary_range: null,
  archived: false,
  hidden: false,
};
const normalizedRemote = runNormalizer(juniorPreview, remoteDetail);
check('full HH vacancy normalizes successfully', normalizedRemote.normalization_ok === true);
check('HH key remains stable through normalization', normalizedRemote.vacancy_key === 'hh:1001');
check('HH HTML description is converted to plain text', !normalizedRemote.description.includes('<p>'));
check('missing employer salary remains allowed', normalizedRemote.salary_specified === false);
check('remote geography is not required by policy', normalizedRemote.remote_geo_eligibility === 'not_required');
check('remote policy is explicit in normalization evidence', normalizedRemote.remote_geo_evidence.includes('remote_allowed_from_any_location_by_policy'));
check('HH work format maps to common remote contract', normalizedRemote.work_format === 'remote' && normalizedRemote.work_format_confidence === 'high');
check('HH experience category maps to entry-level hint', normalizedRemote.experience_min_years_hint === 0);

const hardRemote = hardFilter({ item: { json: normalizedRemote } }).json;
check('HH remote vacancy enters common filter', hardRemote.hard_filter_decision === 'PASS');
check('common filter still excludes salary', hardRemote.salary_filter_applied === false);

const unknownRemote = runNormalizer(juniorPreview, {
  ...remoteDetail,
  description: '<p>Build LLM systems and RAG pipelines.</p>',
});
const hardUnknown = hardFilter({ item: { json: unknownRemote } }).json;
check('remote without geography evidence is accepted', hardUnknown.hard_filter_decision === 'PASS');
check('remote without geography evidence uses global remote policy', hardUnknown.hard_filter_geo_work_gate.code === 'allow_full_remote');

const restrictedRemote = runNormalizer(juniorPreview, {
  ...remoteDetail,
  description: '<p>Build LLM systems. Работа только на территории РФ.</p>',
});
const hardRestricted = hardFilter({ item: { json: restrictedRemote } }).json;
check('Russia-only remote vacancy is accepted by policy', hardRestricted.hard_filter_decision === 'PASS');
check('restricted remote geography still uses global remote policy', hardRestricted.hard_filter_geo_work_gate.code === 'allow_full_remote');

const tbilisiPreview = {
  ...juniorPreview,
  source_id: '2001',
  source_state_key: 'hh:2001',
  vacancy_key: 'hh:2001',
};
const tbilisi = runNormalizer(tbilisiPreview, {
  ...remoteDetail,
  id: '2001',
  alternate_url: 'https://hh.ru/vacancy/2001',
  url: 'https://api.hh.ru/vacancies/2001',
  area: { name: 'Tbilisi' },
  address: { city: 'Tbilisi', raw: 'Tbilisi, Georgia' },
  work_format: [{ id: 'HYBRID', name: 'Гибрид' }],
  description: '<p>Build LLM systems and RAG pipelines in Tbilisi.</p>',
});
const hardTbilisi = hardFilter({ item: { json: tbilisi } }).json;
check('Tbilisi is normalized as Georgia', tbilisi.is_tbilisi === true && tbilisi.is_georgia === true);
check('Tbilisi hybrid vacancy passes common geography policy', hardTbilisi.hard_filter_decision === 'PASS');

const broken = runNormalizer(juniorPreview, { errors: [{ type: 'oauth' }] }, 403);
check('HTTP failure becomes a retryable normalization failure', broken.normalization_ok === false);
check('HTTP failure retains source state key', broken.source_state_key === 'hh:1001');

const failures = checks.filter(([, passed]) => !passed);
if (failures.length > 0) {
  for (const [name] of failures) console.error('FAIL', name);
  process.exitCode = 1;
} else {
  console.log(`PASS: ${checks.length} HeadHunter integration checks`);
}
