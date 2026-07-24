/**
 * MARK — HeadHunter Vacancy Normalizer
 * Version: 1.1.0
 * n8n Code node mode: Run Once for Each Item
 */

const HH_NORMALIZER_VERSION = '1.1.0';

function text(value) {
  return String(value ?? '').trim();
}

function stripHtml(value) {
  return text(value)
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<\/li\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

function stringArray(value, field = 'name') {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => text(item?.[field] ?? item)).filter(Boolean))];
}

function upstreamPreview() {
  try {
    return $('HH Search Result Pre-filter').item?.json ?? {};
  } catch {
    return {};
  }
}

function normalizedResponse(json) {
  if (json && typeof json.body === 'object' && json.body !== null) {
    return {
      statusCode: Number(json.statusCode ?? 200),
      body: json.body,
    };
  }
  return {
    statusCode: Number(json?.statusCode ?? 200),
    body: json,
  };
}

function experienceHint(id) {
  switch (text(id)) {
    case 'noExperience': return { min: 0, max: 0 };
    case 'between1And3': return { min: 1, max: 3 };
    case 'between3And6': return { min: 3, max: 6 };
    case 'moreThan6': return { min: 6, max: null };
    default: return { min: null, max: null };
  }
}

function workFormat(vacancy) {
  const ids = Array.isArray(vacancy?.work_format)
    ? vacancy.work_format.map((item) => text(item?.id).toUpperCase()).filter(Boolean)
    : [];
  const distinct = [...new Set(ids)];

  if (distinct.length > 1) {
    return { value: 'unknown', confidence: 'high', conflict: true, ids: distinct };
  }

  const mapped = {
    REMOTE: 'remote',
    HYBRID: 'hybrid',
    ON_SITE: 'office',
  }[distinct[0]];
  if (mapped) return { value: mapped, confidence: 'high', conflict: false, ids: distinct };

  if (text(vacancy?.schedule?.id).toLowerCase() === 'remote') {
    return { value: 'remote', confidence: 'medium', conflict: false, ids: ['legacy_schedule_remote'] };
  }

  return { value: 'unknown', confidence: 'low', conflict: false, ids: distinct };
}

function remoteEligibility(format) {
  if (format !== 'remote') {
    return { value: 'not_applicable', evidence: [] };
  }

  return {
    value: 'not_required',
    evidence: ['remote_allowed_from_any_location_by_policy'],
  };
}

function salaryFields(vacancy) {
  const salary = vacancy?.salary_range ?? vacancy?.salary ?? null;
  if (!salary || typeof salary !== 'object') {
    return {
      salary_specified: false,
      salary_from: null,
      salary_to: null,
      salary_currency: null,
      salary_gross: null,
      salary_frequency: null,
      salary_formatted: null,
    };
  }

  const from = Number.isFinite(Number(salary.from)) ? Number(salary.from) : null;
  const to = Number.isFinite(Number(salary.to)) ? Number(salary.to) : null;
  const currency = text(salary.currency) || null;
  const range = from !== null && to !== null
    ? `${from}–${to}`
    : from !== null
      ? `от ${from}`
      : to !== null
        ? `до ${to}`
        : '';

  return {
    salary_specified: from !== null || to !== null,
    salary_from: from,
    salary_to: to,
    salary_currency: currency,
    salary_gross: typeof salary.gross === 'boolean' ? salary.gross : null,
    salary_frequency: text(salary.frequency?.id) || null,
    salary_formatted: range ? `${range}${currency ? ` ${currency}` : ''}` : null,
  };
}

const inputItem = $input.item;
const raw = inputItem?.json ?? {};
const preview = upstreamPreview();
const response = normalizedResponse(raw);
const vacancy = response.body ?? {};
const sourceId = text(vacancy.id || preview.source_id);
const title = text(vacancy.name || preview.title);
const description = stripHtml(vacancy.description);
const publicUrl = text(vacancy.alternate_url || preview.url || (sourceId ? `https://hh.ru/vacancy/${sourceId}` : ''));
const area = text(vacancy.area?.name || preview.location);
const addressCity = text(vacancy.address?.city);
const city = addressCity || area || null;
const locations = [...new Set([area, addressCity, text(vacancy.address?.raw)].filter(Boolean))];
const format = workFormat(vacancy);
const remoteGeo = remoteEligibility(format.value);
const exp = experienceHint(vacancy.experience?.id || preview.hh_preview_experience_id);
const normalizationErrors = [];

if (response.statusCode < 200 || response.statusCode >= 300) {
  normalizationErrors.push(`hh_http_${response.statusCode}`);
}
if (!sourceId) normalizationErrors.push('source_id_missing');
if (!title) normalizationErrors.push('title_missing');
if (!description) normalizationErrors.push('description_missing');
if (!publicUrl) normalizationErrors.push('url_missing');

const isTbilisi = /(?:тбилиси|tbilisi|თბილისი)/iu.test(locations.join(' '));
const isGeorgia = isTbilisi || /(?:грузи(?:я|и)|georgia|საქართველო)/iu.test(locations.join(' '));

return {
  ...inputItem,
  json: {
    ...preview,
    source: 'headhunter',
    source_id: sourceId || null,
    source_guid: sourceId ? `hh:${sourceId}` : preview.source_guid ?? null,
    source_state_key: preview.source_state_key || (sourceId ? `hh:${sourceId}` : null),
    vacancy_key: sourceId ? `hh:${sourceId}` : preview.vacancy_key ?? null,
    api_url: text(vacancy.url || preview.api_url) || null,
    url: publicUrl || null,
    title: title || null,
    company: text(vacancy.employer?.name || preview.company) || null,
    description,
    skills: stringArray(vacancy.key_skills),
    professional_roles: stringArray(vacancy.professional_roles),
    employment: text(vacancy.employment_form?.name || vacancy.employment?.name) || null,
    experience: text(vacancy.experience?.name || preview.hh_preview_experience_name) || null,
    experience_id: text(vacancy.experience?.id || preview.hh_preview_experience_id) || null,
    experience_min_years_hint: exp.min,
    experience_max_years_hint: exp.max,
    location: locations.join(', ') || null,
    locations,
    city,
    country: isGeorgia ? 'Georgia' : null,
    is_tbilisi: isTbilisi,
    is_georgia: isGeorgia,
    work_format: format.value,
    work_format_confidence: format.confidence,
    work_format_conflict: format.conflict,
    work_format_evidence: format.ids,
    remote_geo_eligibility: remoteGeo.value,
    remote_geo_evidence: remoteGeo.evidence,
    remote_denied: false,
    archived: vacancy.archived === true,
    hidden: vacancy.hidden === true,
    status: vacancy.archived === true ? 'archived' : vacancy.hidden === true ? 'hidden' : 'active',
    published_at: text(vacancy.published_at || preview.published_at) || null,
    created_at: text(vacancy.created_at || preview.created_at) || null,
    ...salaryFields(vacancy),
    predicted_salary_available: false,
    predicted_salary_formatted: null,
    salary_filter_applied: false,
    normalization_ok: normalizationErrors.length === 0,
    normalization_errors: normalizationErrors,
    normalization_warnings: [],
    normalizer_version: HH_NORMALIZER_VERSION,
  },
};
