/**
 * MARK — Habr Career Vacancy Normalizer
 * Version: 1.0.0
 *
 * n8n Code node mode: Run Once for Each Item
 *
 * Expected input:
 *   $json.data — HTML returned by "Fetch Habr Vacancy Page"
 *
 * Data priority:
 *   1. Habr SSR state
 *   2. JSON-LD JobPosting
 *   3. Linked RSS metadata (diagnostic fallback only)
 *
 * Important policies:
 *   - the node normalizes; it does not reject vacancies;
 *   - employer salary and Habr predicted salary never mix;
 *   - missing salary is not an error;
 *   - remoteWork === false does not mean office;
 *   - one malformed page returns diagnostics instead of failing the batch;
 *   - raw page HTML is never included in the output.
 */

const NORMALIZER_VERSION = '1.0.0';
const SCHEMA_VERSION = 'mark.vacancy.v1';
const HABR_BASE_URL = 'https://career.habr.com';

const errors = [];
const warnings = [];

function isPresent(value) {
  return value !== null &&
    value !== undefined &&
    !(typeof value === 'string' && value.trim() === '');
}

function firstPresent(...values) {
  for (const value of values) {
    if (isPresent(value)) return value;
  }

  return null;
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function toText(value) {
  if (!isPresent(value)) return null;

  if (typeof value === 'string') {
    const result = value.trim();
    return result || null;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    const result = value.map(toText).filter(Boolean).join(', ');
    return result || null;
  }

  if (typeof value === 'object') {
    return toText(firstPresent(
      value.title,
      value.name,
      value.label,
      value.text,
      value.value,
      value.code,
    ));
  }

  return null;
}

function uniqueStrings(values) {
  const result = [];
  const seen = new Set();

  for (const value of values.flat(Infinity)) {
    const text = toText(value);
    if (!text) continue;

    const key = text.toLocaleLowerCase('ru-RU');
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(text);
  }

  return result;
}

function decodeHtmlEntities(value) {
  const named = {
    amp: '&',
    apos: "'",
    quot: '"',
    lt: '<',
    gt: '>',
    nbsp: ' ',
    ndash: '–',
    mdash: '—',
    hellip: '…',
    laquo: '«',
    raquo: '»',
    bull: '•',
  };

  return String(value ?? '')
    .replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (match, hex, decimal) => {
      const codePoint = hex
        ? Number.parseInt(hex, 16)
        : Number.parseInt(decimal, 10);

      if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10FFFF) {
        return match;
      }

      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return match;
      }
    })
    .replace(/&([a-z]+);/gi, (match, name) =>
      named[name.toLowerCase()] ?? match,
    );
}

function htmlToText(value) {
  if (!isPresent(value)) return '';

  return decodeHtmlEntities(
    String(value)
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '\n• ')
      .replace(/<\/li>/gi, '\n')
      .replace(
        /<\/(?:p|div|section|article|header|footer|h[1-6]|ul|ol|table|tr)>/gi,
        '\n',
      )
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeSearchText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeJsonParse(value) {
  if (!isPresent(value)) return null;

  let text = String(value)
    .trim()
    .replace(/^<!--/, '')
    .replace(/-->$/, '')
    .replace(/;$/, '')
    .trim();

  const attempts = [text, decodeHtmlEntities(text)];

  for (const attempt of attempts) {
    try {
      let parsed = JSON.parse(attempt);

      if (typeof parsed === 'string') {
        parsed = JSON.parse(parsed);
      }

      return parsed;
    } catch {
      // Try the next representation.
    }
  }

  if (/^JSON\.parse\s*\(/i.test(text) && text.endsWith(')')) {
    const argument = text.slice(text.indexOf('(') + 1, -1).trim();

    try {
      const decoded = JSON.parse(argument);
      return typeof decoded === 'string'
        ? JSON.parse(decoded)
        : decoded;
    } catch {
      return null;
    }
  }

  return null;
}

function scriptBlocks(html) {
  if (!html) return [];

  const blocks = [];
  const regex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = regex.exec(html)) !== null) {
    blocks.push({
      attributes: match[1] ?? '',
      content: match[2] ?? '',
    });
  }

  return blocks;
}

function extractSsrStates(html) {
  const states = [];

  for (const block of scriptBlocks(html)) {
    if (!/\bdata-ssr-state(?:\s*=\s*(?:["']?true["']?))?/i.test(block.attributes)) {
      continue;
    }

    const parsed = safeJsonParse(block.content);
    if (parsed && typeof parsed === 'object') {
      states.push(parsed);
    } else {
      warnings.push('habr_ssr_state_parse_failed');
    }
  }

  if (states.length === 0) {
    warnings.push('habr_ssr_state_not_found');
  }

  return states;
}

function extractVacancyId(...values) {
  for (const value of values) {
    const text = toText(value);
    if (!text) continue;

    const urlMatch = text.match(/\/vacancies\/(\d+)/i);
    if (urlMatch) return urlMatch[1];

    if (/^\d{6,}$/.test(text)) return text;

    const longNumber = text.match(/(?:^|\D)(\d{6,})(?:\D|$)/);
    if (longNumber) return longNumber[1];
  }

  return null;
}

function findVacancyObject(states, expectedId) {
  let best = null;
  let bestScore = -1;
  const seen = new Set();

  function inspect(value, path, depth) {
    if (!value || typeof value !== 'object' || depth > 10 || seen.has(value)) {
      return;
    }

    seen.add(value);

    if (!Array.isArray(value)) {
      const objectId = extractVacancyId(value.id, value.href, value.url);
      const hasTitle = isPresent(value.title);
      const hasDescription = isPresent(value.description);
      const hasCompany = isPresent(value.company);

      if (hasTitle && hasDescription && (hasCompany || objectId)) {
        let score = 0;

        if (expectedId && objectId === expectedId) score += 30;
        if (/\.vacancy$|^vacancy$/i.test(path)) score += 10;
        if (objectId) score += 3;
        if (hasTitle) score += 3;
        if (hasDescription) score += 6;
        if (hasCompany) score += 3;
        if (Array.isArray(value.skills)) score += 2;
        if (Object.prototype.hasOwnProperty.call(value, 'remoteWork')) score += 2;
        if (Object.prototype.hasOwnProperty.call(value, 'predictedSalary')) score += 2;

        if (score > bestScore) {
          best = value;
          bestScore = score;
        }
      }
    }

    const entries = Array.isArray(value)
      ? value.slice(0, 250).map((item, index) => [String(index), item])
      : Object.entries(value).slice(0, 250);

    for (const [key, child] of entries) {
      if (child && typeof child === 'object') {
        inspect(child, path ? `${path}.${key}` : key, depth + 1);
      }
    }
  }

  for (const state of states) {
    inspect(state, '', 0);
  }

  return best;
}

function hasSchemaType(value, expectedType) {
  const types = Array.isArray(value) ? value : [value];

  return types.some((type) =>
    String(type ?? '').toLowerCase() === expectedType.toLowerCase(),
  );
}

function findJobPosting(value, depth = 0) {
  if (!value || depth > 10) return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJobPosting(item, depth + 1);
      if (found) return found;
    }

    return null;
  }

  if (typeof value !== 'object') return null;

  if (hasSchemaType(value['@type'], 'JobPosting')) {
    return value;
  }

  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') {
      const found = findJobPosting(child, depth + 1);
      if (found) return found;
    }
  }

  return null;
}

function extractJsonLdJobPosting(html) {
  for (const block of scriptBlocks(html)) {
    if (!/\btype\s*=\s*["']application\/ld\+json["']/i.test(block.attributes)) {
      continue;
    }

    const parsed = safeJsonParse(block.content);
    if (!parsed) continue;

    const found = findJobPosting(parsed);
    if (found) return found;
  }

  warnings.push('job_posting_json_ld_not_found');
  return null;
}

function absoluteUrl(value) {
  const text = toText(value);
  if (!text) return null;

  try {
    return new URL(text, HABR_BASE_URL).href;
  } catch {
    return text;
  }
}

function normalizeDate(value) {
  const text = toText(
    value && typeof value === 'object'
      ? firstPresent(value.date, value.iso, value.isoDate, value.value, value.formatted)
      : value,
  );

  if (!text) return null;

  const timestamp = Date.parse(text);
  return Number.isNaN(timestamp)
    ? text
    : new Date(timestamp).toISOString();
}

function parseNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const text = toText(value);
  if (!text) return null;

  const match = text
    .replace(/[\s\u00a0]+/g, '')
    .replace(',', '.')
    .match(/-?\d+(?:\.\d+)?/);

  if (!match) return null;

  const result = Number(match[0]);
  return Number.isFinite(result) ? result : null;
}

function normalizeCurrency(value) {
  const text = toText(value);
  if (!text) return null;

  const normalized = text.toUpperCase();
  const aliases = {
    '₽': 'RUR',
    RUB: 'RUR',
    RUR: 'RUR',
    '$': 'USD',
    USD: 'USD',
    '€': 'EUR',
    EUR: 'EUR',
    '₾': 'GEL',
    GEL: 'GEL',
  };

  return aliases[normalized] ?? normalized;
}

function normalizeSalary(rawSalary, jsonLdSalary = null) {
  const raw = asObject(rawSalary);
  const ld = asObject(jsonLdSalary);
  const ldValue = asObject(ld.value);

  const exactValue = parseNumber(firstPresent(
    raw.value,
    ldValue.value,
    typeof ld.value === 'number' ? ld.value : null,
  ));

  let from = parseNumber(firstPresent(
    raw.from,
    raw.min,
    raw.minValue,
    ldValue.minValue,
    ld.minValue,
  ));

  let to = parseNumber(firstPresent(
    raw.to,
    raw.max,
    raw.maxValue,
    ldValue.maxValue,
    ld.maxValue,
  ));

  if (exactValue !== null) {
    if (from === null) from = exactValue;
    if (to === null) to = exactValue;
  }

  const formatted = toText(firstPresent(raw.formatted, raw.display, raw.text));

  return {
    from,
    to,
    currency: normalizeCurrency(firstPresent(
      raw.currency,
      raw.currencyCode,
      ld.currency,
      ldValue.currency,
    )),
    formatted,
    period: toText(firstPresent(raw.period, raw.unit, ldValue.unitText, ld.unitText)),
    specified: from !== null || to !== null || Boolean(formatted),
  };
}

function labelsFrom(value) {
  if (!isPresent(value)) return [];

  const values = Array.isArray(value) ? value : [value];

  return uniqueStrings(values.map((item) =>
    typeof item === 'string'
      ? item
      : firstPresent(item?.title, item?.name, item?.label, item?.value),
  ));
}

function splitSkillText(value) {
  if (!isPresent(value)) return [];

  if (Array.isArray(value)) {
    return uniqueStrings(value.flatMap(splitSkillText));
  }

  if (typeof value === 'object') return labelsFrom(value);

  return uniqueStrings(
    String(value)
      .replace(/#/g, '')
      .split(/[,;\n|]+/)
      .map((item) => item.trim()),
  );
}

function collectLocationData(value, accumulator) {
  if (!isPresent(value)) return;

  if (Array.isArray(value)) {
    for (const item of value) collectLocationData(item, accumulator);
    return;
  }

  if (typeof value === 'string') {
    accumulator.labels.push(value);
    return;
  }

  if (typeof value !== 'object') return;

  const label = toText(firstPresent(value.title, value.name, value.label, value.value));
  if (label) accumulator.labels.push(label);

  const city = toText(firstPresent(
    value.city?.title,
    value.city?.name,
    value.city,
    value.addressLocality,
    value.locality,
  ));
  if (city) accumulator.cities.push(city);

  const country = toText(firstPresent(
    value.country?.title,
    value.country?.name,
    value.country?.code,
    value.country,
    value.addressCountry?.name,
    value.addressCountry?.code,
    value.addressCountry,
  ));
  if (country) accumulator.countries.push(country);

  if (value.address) collectLocationData(value.address, accumulator);
}

function detectGeography(accumulator, humanCityNames, shortGeo) {
  const labels = uniqueStrings([
    accumulator.labels,
    humanCityNames,
    shortGeo,
  ]);
  const cities = uniqueStrings(accumulator.cities);
  const countries = uniqueStrings(accumulator.countries);
  const text = uniqueStrings([labels, cities, countries]).join(' ');

  const isTbilisi = /(?:^|[^\p{L}])(?:тбилиси|tbilisi|თბილისი)(?=$|[^\p{L}])/iu.test(text);
  const explicitGeorgia = /(?:^|[^\p{L}])(?:грузи(?:я|и)|საქართველო)(?=$|[^\p{L}])/iu.test(text);
  const englishGeorgia = /(?:^|[^\p{L}])georgia(?=$|[^\p{L}])/iu.test(text);
  const looksLikeUsGeorgia = /\b(?:usa|u\.s\.a|united states|georgia,\s*ga|ga,\s*usa|atlanta)\b/i.test(text);
  const isGeorgia = isTbilisi || explicitGeorgia || (englishGeorgia && !looksLikeUsGeorgia);
  const isRussia = /(?:^|[^\p{L}])(?:росси(?:я|и)|russia|russian federation)(?=$|[^\p{L}])/iu.test(text);

  let city = cities[0] ?? null;
  let country = countries[0] ?? null;

  if (!city && isPresent(humanCityNames)) {
    city = String(humanCityNames).split(/[,()]/)[0]?.trim() || null;
  }

  if (!city && labels.length) {
    city = labels[0].split(/[,()]/)[0]?.trim() || null;
  }

  if (isTbilisi) city = 'Tbilisi';
  if (isGeorgia) country = 'Georgia';
  else if (isRussia) country = 'Russia';

  return {
    location: firstPresent(toText(humanCityNames), toText(shortGeo), labels.join(', ')),
    locations: labels,
    short_geo: toText(shortGeo),
    city,
    country,
    is_tbilisi: isTbilisi,
    is_georgia: isGeorgia,
  };
}

function matchesAny(patterns, text) {
  return patterns.some((pattern) => pattern.test(text));
}

function detectWorkSignals(value) {
  const text = normalizeSearchText(value);

  const remotePatterns = [
    /полност\p{L}*\s+(?:удален|дистанцион)/u,
    /можно\s+(?:работать\s+)?удален/u,
    /удаленн\p{L}*\s+(?:работ|формат|позици)/u,
    /работ\p{L}*\s+удален/u,
    /дистанционн\p{L}*\s+(?:работ|формат)/u,
    /\bfully[\s-]*remote\b/i,
    /\bfull[\s-]*remote\b/i,
    /\bremote[\s-]*first\b/i,
    /\bwork[\s-]*from[\s-]*anywhere\b/i,
    /\bremote\b/i,
  ];

  const hybridPatterns = [
    /гибрид/u,
    /частичн\p{L}*\s+(?:удален|дистанцион)/u,
    /\bhybrid\b/i,
    /\d+\s+дн\p{L}*\s+в\s+офис/u,
    /несколько\s+дн\p{L}*\s+в\s+офис/u,
  ];

  const officePatterns = [
    /только\s+офис/u,
    /исключительн\p{L}*\s+(?:из|в)\s+офис/u,
    /работ\p{L}*\s+(?:из|в)\s+офис/u,
    /офисн\p{L}*\s+(?:формат|работ|график)/u,
    /обязательн\p{L}*\s+посещен\p{L}*\s+офис/u,
    /\b(?:on[\s-]*site|onsite)\b/i,
    /\boffice[\s-]*based\b/i,
  ];

  const deniedPatterns = [
    /удаленн\p{L}*\s+работ\p{L}*\s+не\s+предусмотр/u,
    /удаленк\p{L}*\s+не\s+предусмотр/u,
    /без\s+возможност\p{L}*\s+(?:работать\s+)?удален/u,
    /нет\s+возможност\p{L}*\s+(?:работать\s+)?удален/u,
    /только\s+офис/u,
    /исключительн\p{L}*\s+(?:из|в)\s+офис/u,
    /\bno[\s-]*remote\b/i,
    /\bremote\s+(?:is\s+)?not\s+available\b/i,
  ];

  return {
    remote: matchesAny(remotePatterns, text),
    hybrid: matchesAny(hybridPatterns, text),
    office: matchesAny(officePatterns, text),
    remote_denied: matchesAny(deniedPatterns, text),
  };
}

function detectWorkFormat({ structuredRemote, jsonLdRemote, fullText, rssText, source }) {
  const full = detectWorkSignals(fullText);
  const rss = detectWorkSignals(rssText);
  const rssHint = ['remote', 'hybrid', 'office'].includes(source.work_format_hint)
    ? source.work_format_hint
    : null;

  const evidence = [];
  if (structuredRemote) evidence.push('habr.remoteWork=true');
  if (jsonLdRemote) evidence.push('jsonld.jobLocationType=TELECOMMUTE');
  for (const [name, matched] of Object.entries(full)) {
    if (matched) evidence.push(`full_description:${name}`);
  }
  if (rssHint) evidence.push(`rss_hint:${rssHint}`);

  let workFormat = 'unknown';
  let confidence = 'low';
  let formatSource = 'unknown';

  if (structuredRemote || jsonLdRemote) {
    workFormat = 'remote';
    confidence = 'high';
    formatSource = 'structured_data';
  } else if (full.hybrid) {
    workFormat = 'hybrid';
    confidence = 'high';
    formatSource = 'full_description';
  } else if (full.remote && !full.remote_denied) {
    workFormat = 'remote';
    confidence = 'high';
    formatSource = 'full_description';
  } else if (full.office) {
    workFormat = 'office';
    confidence = 'high';
    formatSource = 'full_description';
  } else if (rssHint) {
    workFormat = rssHint;
    confidence = ['high', 'medium', 'low'].includes(source.work_format_confidence)
      ? source.work_format_confidence
      : 'medium';
    formatSource = 'rss_text';
  } else if (rss.hybrid) {
    workFormat = 'hybrid';
    confidence = 'medium';
    formatSource = 'rss_text';
  } else if (rss.remote && !rss.remote_denied) {
    workFormat = 'remote';
    confidence = 'medium';
    formatSource = 'rss_text';
  } else if (rss.office) {
    workFormat = 'office';
    confidence = 'medium';
    formatSource = 'rss_text';
  }

  const conflict = Boolean(source.work_format_conflict) ||
    ((structuredRemote || jsonLdRemote) && (full.hybrid || full.office || full.remote_denied)) ||
    (full.remote && (full.hybrid || full.office || full.remote_denied)) ||
    (rss.remote && (rss.hybrid || rss.office || rss.remote_denied));

  if (conflict) warnings.push('work_format_conflict_detected');
  if (workFormat === 'unknown') warnings.push('work_format_unknown');

  return {
    work_format: workFormat,
    work_format_confidence: confidence,
    work_format_source: formatSource,
    work_format_conflict: conflict,
    work_format_evidence: uniqueStrings(evidence),
    remote_allowed_by_source: Boolean(structuredRemote || jsonLdRemote),
    remote_denied: Boolean(full.remote_denied || rss.remote_denied),
  };
}

function geoPolicyHint(workFormat, geography) {
  if (workFormat.work_format_conflict) return 'needs_review_conflict';
  if (workFormat.work_format === 'remote') return 'allow_remote';

  if (['hybrid', 'office'].includes(workFormat.work_format)) {
    return geography.is_tbilisi && geography.is_georgia
      ? 'allow_tbilisi'
      : 'reject_non_tbilisi';
  }

  return 'needs_review';
}

function sanitizeDiagnosticValue(value, depth = 0) {
  if (depth > 3) return null;

  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) =>
      sanitizeDiagnosticValue(item, depth + 1),
    );
  }

  if (typeof value === 'object') {
    const output = {};
    for (const [key, item] of Object.entries(value).slice(0, 100)) {
      output[key] = sanitizeDiagnosticValue(item, depth + 1);
    }
    return output;
  }

  return null;
}

function collectPrefilterDiagnostics(source) {
  const diagnostics = {};
  const prefixes = [/^prefilter_/, /^matched_/, /^ai_priority_/, /^rss_parsed_/];
  const explicitKeys = new Set([
    'should_fetch_full_page',
    'relevance_confidence',
    'normalized_title',
    'title_role_class',
    'target_role_tier',
    'incidental_ai_only',
    'experience_min_years_hint',
    'experience_max_years_hint',
    'seniority_risk_hint',
    'salary_filter_applied',
  ]);

  for (const [key, value] of Object.entries(source ?? {})) {
    if (explicitKeys.has(key) || prefixes.some((pattern) => pattern.test(key))) {
      diagnostics[key] = sanitizeDiagnosticValue(value);
    }
  }

  diagnostics.rss_work_format_hint = source.work_format_hint ?? null;
  diagnostics.rss_work_format_confidence = source.work_format_confidence ?? null;
  diagnostics.rss_work_format_source = source.work_format_source ?? null;
  diagnostics.rss_work_format_conflict = source.work_format_conflict ?? false;
  diagnostics.rss_remote_signal = source.remote_signal ?? false;
  diagnostics.rss_hybrid_signal = source.hybrid_signal ?? false;
  diagnostics.rss_office_signal = source.office_signal ?? false;
  diagnostics.rss_remote_denied_signal = source.remote_denied_signal ?? false;
  diagnostics.rss_tbilisi_signal = source.tbilisi_signal ?? false;
  diagnostics.rss_georgia_signal = source.georgia_signal ?? false;
  diagnostics.rss_geo_format_policy = source.geo_format_policy ?? null;

  return diagnostics;
}

function getLinkedSource(current) {
  const currentMetadata = {};

  for (const [key, value] of Object.entries(current ?? {})) {
    if (!['data', 'body', 'html', 'response'].includes(key)) {
      currentMetadata[key] = value;
    }
  }

  const nodeNames = ['Dev Limit', 'Keep PASS + REVIEW', 'Habr RSS Pre-filter'];
  let linked = {};

  for (const nodeName of nodeNames) {
    try {
      const candidate = $(nodeName).item.json;
      if (candidate && typeof candidate === 'object') {
        linked = candidate;
        break;
      }
    } catch {
      // Try the next linked node.
    }
  }

  if (Object.keys(linked).length === 0 && Object.keys(currentMetadata).length === 0) {
    warnings.push('linked_rss_source_not_found');
  }

  return { ...linked, ...currentMetadata };
}

function getHtml(current) {
  const candidates = [
    current.data,
    current.body,
    current.html,
    current.response?.body,
    typeof current.response === 'string' ? current.response : null,
  ];

  return candidates.find((value) =>
    typeof value === 'string' && value.trim().length > 100,
  ) ?? '';
}

const inputItem = $input.item;
const current = asObject(inputItem?.json);
const source = getLinkedSource(current);

try {
  const html = getHtml(current);
  if (!html) warnings.push('vacancy_page_html_missing');

  const expectedId = extractVacancyId(source.guid, source.link, current.url, current.link);
  const ssrStates = extractSsrStates(html);
  const vacancy = findVacancyObject(ssrStates, expectedId);
  const jobPosting = extractJsonLdJobPosting(html);

  if (!vacancy) warnings.push('habr_ssr_vacancy_not_found');

  const rssDescription = htmlToText(firstPresent(source.content, source.contentSnippet));
  const description = firstPresent(
    htmlToText(vacancy?.description),
    htmlToText(jobPosting?.description),
    rssDescription,
  ) ?? '';
  const qualification = firstPresent(
    htmlToText(vacancy?.qualification),
    htmlToText(jobPosting?.qualifications),
    '',
  );
  const bannerDescription = htmlToText(vacancy?.bannerDescription);

  const sourceId = extractVacancyId(
    vacancy?.id,
    vacancy?.href,
    jobPosting?.identifier?.value,
    jobPosting?.identifier,
    expectedId,
  );
  const url = absoluteUrl(firstPresent(
    vacancy?.href,
    jobPosting?.url,
    source.link,
    sourceId ? `/vacancies/${sourceId}` : null,
  ));
  const title = toText(firstPresent(
    vacancy?.title,
    jobPosting?.title,
    source.rss_parsed_vacancy_title,
    source.title,
  ));

  const companyData = asObject(firstPresent(
    vacancy?.company,
    ssrStates.find((state) => isPresent(state?.company))?.company,
    jobPosting?.hiringOrganization,
  ));
  const company = toText(firstPresent(
    companyData.title,
    companyData.name,
    source.creator,
    source.author,
  ));

  const skills = uniqueStrings([
    labelsFrom(vacancy?.skills),
    splitSkillText(jobPosting?.skills),
    splitSkillText(source.rss_parsed_skills),
  ]);
  const specializations = uniqueStrings([
    labelsFrom(vacancy?.divisions),
    labelsFrom(vacancy?.specializations),
    splitSkillText(jobPosting?.occupationalCategory),
  ]);

  const locationAccumulator = { labels: [], cities: [], countries: [] };
  collectLocationData(vacancy?.locations, locationAccumulator);
  collectLocationData(vacancy?.location, locationAccumulator);
  collectLocationData(jobPosting?.jobLocation, locationAccumulator);

  const geography = detectGeography(
    locationAccumulator,
    toText(vacancy?.humanCityNames),
    toText(vacancy?.shortGeo),
  );

  const fullDescriptionText = uniqueStrings([
    description,
    qualification,
    bannerDescription,
  ]).join('\n');
  const structuredRemote = vacancy?.remoteWork === true;
  const jsonLdRemote = /\bTELECOMMUTE\b/i.test(toText(jobPosting?.jobLocationType) ?? '');
  const workFormat = detectWorkFormat({
    structuredRemote,
    jsonLdRemote,
    fullText: fullDescriptionText,
    rssText: rssDescription,
    source,
  });

  const actualSalary = normalizeSalary(vacancy?.salary, jobPosting?.baseSalary);
  const predictedSalary = normalizeSalary(vacancy?.predictedSalary);
  const employmentCode = toText(vacancy?.employment);
  const employment = toText(firstPresent(
    vacancy?.employmentType,
    vacancy?.employment,
    jobPosting?.employmentType,
  ));
  const publishedAt = normalizeDate(firstPresent(
    vacancy?.publishedDate,
    jobPosting?.datePosted,
    source.isoDate,
    source.pubDate,
  ));
  const validThrough = normalizeDate(firstPresent(
    jobPosting?.validThrough,
    vacancy?.expiresAt,
  ));

  const structuredFound = Boolean(vacancy || jobPosting);
  if (!structuredFound) errors.push('structured_vacancy_not_found');
  if (!sourceId) errors.push('source_id_missing');
  if (!url) errors.push('url_missing');
  if (!title) errors.push('title_missing');
  if (!description) errors.push('description_missing');

  const normalizationSource = vacancy
    ? 'habr_ssr'
    : jobPosting
      ? 'json_ld'
      : 'rss_fallback';
  const normalizationQuality = vacancy
    ? 'full'
    : jobPosting
      ? 'fallback'
      : 'failed';

  if (!vacancy && jobPosting) warnings.push('json_ld_fallback_used');
  if (!structuredFound) warnings.push('rss_fallback_used');

  const prefilterDiagnostics = collectPrefilterDiagnostics(source);
  const archived = vacancy?.archived === true;
  const hidden = vacancy?.hidden === true;

  const normalized = {
    schema_version: SCHEMA_VERSION,
    normalizer_version: NORMALIZER_VERSION,
    normalization_source: normalizationSource,
    normalization_quality: normalizationQuality,
    normalization_ok: structuredFound && errors.length === 0,
    normalization_errors: uniqueStrings(errors),
    normalization_warnings: uniqueStrings(warnings),

    source: 'habr_career',
    source_id: sourceId,
    vacancy_key: sourceId ? `habr:${sourceId}` : null,
    source_guid: toText(source.guid),
    url,

    title,
    company,
    company_id: toText(firstPresent(companyData.id, companyData.identifier)),
    company_url: absoluteUrl(firstPresent(companyData.href, companyData.url)),
    company_accredited: companyData.accredited === true,

    published_at: publishedAt,
    valid_through: validThrough,
    archived,
    hidden,
    status: archived ? 'archived' : hidden ? 'hidden' : 'active',

    location: geography.location,
    locations: geography.locations,
    short_geo: geography.short_geo,
    country: geography.country,
    city: geography.city,
    is_tbilisi: geography.is_tbilisi,
    is_georgia: geography.is_georgia,

    ...workFormat,
    geo_policy_hint: geoPolicyHint(workFormat, geography),

    employment,
    employment_code: employmentCode,
    qualification: qualification || null,

    salary_specified: actualSalary.specified,
    salary_from: actualSalary.from,
    salary_to: actualSalary.to,
    salary_currency: actualSalary.currency,
    salary_formatted: actualSalary.formatted,
    salary_period: actualSalary.period,

    predicted_salary_available: predictedSalary.specified,
    predicted_salary_from: predictedSalary.from,
    predicted_salary_to: predictedSalary.to,
    predicted_salary_currency: predictedSalary.currency,
    predicted_salary_formatted: predictedSalary.formatted,
    predicted_salary_period: predictedSalary.period,

    specializations,
    skills,
    description,
    description_length: description.length,
    banner_description: bannerDescription || null,

    ...prefilterDiagnostics,
    prefilter_diagnostics: prefilterDiagnostics,
    salary_filter_applied: false,
  };

  return {
    ...inputItem,
    json: normalized,
  };
} catch (error) {
  const sourceId = extractVacancyId(source.guid, source.link);
  const message = error instanceof Error ? error.message : String(error);

  return {
    ...inputItem,
    json: {
      schema_version: SCHEMA_VERSION,
      normalizer_version: NORMALIZER_VERSION,
      normalization_source: 'failed',
      normalization_quality: 'failed',
      normalization_ok: false,
      normalization_errors: uniqueStrings([
        ...errors,
        `unexpected_normalizer_error: ${message}`,
      ]),
      normalization_warnings: uniqueStrings(warnings),

      source: 'habr_career',
      source_id: sourceId,
      vacancy_key: sourceId ? `habr:${sourceId}` : null,
      source_guid: toText(source.guid),
      url: absoluteUrl(source.link),
      title: toText(firstPresent(source.rss_parsed_vacancy_title, source.title)),
      company: toText(firstPresent(source.creator, source.author)),

      salary_filter_applied: false,
      prefilter_diagnostics: collectPrefilterDiagnostics(source),
    },
  };
}
