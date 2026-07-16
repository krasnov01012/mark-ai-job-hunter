/**
 * MARK — Vacancy Level Filter
 * Version: 1.0.0
 *
 * n8n Code node mode: Run Once for Each Item
 *
 * Policy:
 *   - Junior / Intern: PASS;
 *   - Middle: PASS unless experience requirements make it a stretch;
 *   - reasonable 2–4 year or unknown-level roles: STRETCH and continue;
 *   - explicit Senior / Lead / Principal / Staff / Head / Architect: REJECT;
 *   - explicit minimum 5+ years: REJECT;
 *   - salary and work geography are not evaluated here.
 */

const LEVEL_FILTER_VERSION = '1.0.0';

function isPresent(value) {
  return value !== null &&
    value !== undefined &&
    !(typeof value === 'string' && value.trim() === '');
}

function text(value) {
  return isPresent(value) ? String(value).trim() : '';
}

function normalizeText(value) {
  return text(value)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function stringArray(value) {
  if (!isPresent(value)) return [];

  const values = Array.isArray(value) ? value : [value];
  const result = [];
  const seen = new Set();

  for (const item of values.flat(Infinity)) {
    const itemText = text(item);
    if (!itemText) continue;

    const key = itemText.toLocaleLowerCase('ru-RU');
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(itemText);
  }

  return result;
}

function decision(value, code, reasons = [], warnings = []) {
  return {
    decision: value,
    code,
    reasons: stringArray(reasons),
    warnings: stringArray(warnings),
  };
}

function replaceNumberWords(value) {
  const replacements = [
    [/(?:^|[^\p{L}])(?:одного|один|одна|one)(?=$|[^\p{L}])/giu, ' 1 '],
    [/(?:^|[^\p{L}])(?:двух|два|две|two)(?=$|[^\p{L}])/giu, ' 2 '],
    [/(?:^|[^\p{L}])(?:трех|три|three)(?=$|[^\p{L}])/giu, ' 3 '],
    [/(?:^|[^\p{L}])(?:четырех|четыре|four)(?=$|[^\p{L}])/giu, ' 4 '],
    [/(?:^|[^\p{L}])(?:пяти|пять|five)(?=$|[^\p{L}])/giu, ' 5 '],
    [/(?:^|[^\p{L}])(?:шести|шесть|six)(?=$|[^\p{L}])/giu, ' 6 '],
    [/(?:^|[^\p{L}])(?:семи|семь|seven)(?=$|[^\p{L}])/giu, ' 7 '],
    [/(?:^|[^\p{L}])(?:восьми|восемь|eight)(?=$|[^\p{L}])/giu, ' 8 '],
    [/(?:^|[^\p{L}])(?:девяти|девять|nine)(?=$|[^\p{L}])/giu, ' 9 '],
    [/(?:^|[^\p{L}])(?:десяти|десять|ten)(?=$|[^\p{L}])/giu, ' 10 '],
  ];

  let result = normalizeText(value);
  for (const [pattern, replacement] of replacements) {
    result = result.replace(pattern, replacement);
  }

  return result.replace(/\s+/g, ' ').trim();
}

function extractExperience(description) {
  const value = replaceNumberWords(description);
  const matches = [];

  const patterns = [
    /(?:опыт\p{L}*|experience)[^.!?\n]{0,70}?(?:не\s+менее|минимум|от|at\s+least|minimum(?:\s+of)?)?\s*(\d{1,2})\s*(?:\+|(?:-|до|to)\s*(\d{1,2}))?\s*(?:лет|год\p{L}*|years?)/giu,
    /(\d{1,2})\s*(?:\+|(?:-|до|to)\s*(\d{1,2}))?\s*(?:лет|год\p{L}*|years?)[^.!?\n]{0,50}?(?:опыт\p{L}*|experience)/giu,
    /(?:не\s+менее|минимум|от|at\s+least|minimum(?:\s+of)?)\s*(\d{1,2})\s*(?:\+|(?:-|до|to)\s*(\d{1,2}))?\s*(?:лет|год\p{L}*|years?)/giu,
  ];

  for (const pattern of patterns) {
    let match;

    while ((match = pattern.exec(value)) !== null) {
      const min = Number(match[1]);
      const max = match[2] ? Number(match[2]) : null;

      if (!Number.isFinite(min) || min < 0 || min > 30) continue;
      if (max !== null && (!Number.isFinite(max) || max < min || max > 40)) continue;

      matches.push({
        min,
        max,
        evidence: match[0].trim(),
      });
    }
  }

  const deduplicated = [];
  const seen = new Set();

  for (const item of matches) {
    const key = `${item.min}:${item.max ?? ''}:${item.evidence}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduplicated.push(item);
  }

  return deduplicated;
}

function parseHintNumber(value) {
  if (!isPresent(value)) return null;

  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 40
    ? number
    : null;
}

function experienceEvidence(vacancy) {
  const fullPage = extractExperience(vacancy.description);
  const prefilterMin = parseHintNumber(vacancy.experience_min_years_hint);
  const prefilterMax = parseHintNumber(vacancy.experience_max_years_hint);

  if (fullPage.length > 0) {
    return {
      min_years: Math.max(...fullPage.map((item) => item.min)),
      max_years: Math.max(
        ...fullPage.map((item) => item.max ?? item.min),
      ),
      confidence: 'high',
      source: 'full_description',
      signals: stringArray(fullPage.map((item) => item.evidence)),
    };
  }

  if (prefilterMin !== null || prefilterMax !== null) {
    return {
      min_years: prefilterMin,
      max_years: prefilterMax ?? prefilterMin,
      confidence: 'medium',
      source: 'rss_prefilter',
      signals: stringArray(vacancy.matched_experience_signals),
    };
  }

  return {
    min_years: null,
    max_years: null,
    confidence: 'low',
    source: 'not_found',
    signals: [],
  };
}

function titleLevelEvidence(title) {
  const value = normalizeText(title);

  const highLevelPatterns = [
    { level: 'lead', regex: /(?:^|[^\p{L}])(?:team[\s-]*lead|tech[\s-]*lead|lead|лид|ведущ\p{L}*)(?=$|[^\p{L}])/iu },
    { level: 'principal', regex: /(?:^|[^\p{L}])principal(?=$|[^\p{L}])/iu },
    { level: 'staff', regex: /(?:^|[^\p{L}])staff(?=$|[^\p{L}])/iu },
    { level: 'head', regex: /(?:^|[^\p{L}])(?:head|руководител\p{L}*)(?=$|[^\p{L}])/iu },
    { level: 'architect', regex: /(?:^|[^\p{L}])(?:architect|архитектор\p{L}*)(?=$|[^\p{L}])/iu },
    { level: 'senior', regex: /(?:^|[^\p{L}])(?:senior|sr\.?|сеньор|старш\p{L}*)(?=$|[^\p{L}])/iu },
  ];

  for (const item of highLevelPatterns) {
    if (item.regex.test(value)) {
      return {
        level: item.level,
        confidence: 'high',
        source: 'title',
        signal: item.regex.source,
        high_level: true,
      };
    }
  }

  if (/(?:^|[^\p{L}])(?:junior|jr\.?|джун\p{L}*|начинающ\p{L}*)(?=$|[^\p{L}])/iu.test(value)) {
    return {
      level: 'junior',
      confidence: 'high',
      source: 'title',
      signal: 'junior_title',
      high_level: false,
    };
  }

  if (/(?:^|[^\p{L}])(?:intern|trainee|стажер\p{L}*)(?=$|[^\p{L}])/iu.test(value)) {
    return {
      level: 'intern',
      confidence: 'high',
      source: 'title',
      signal: 'intern_title',
      high_level: false,
    };
  }

  if (/(?:^|[^\p{L}])(?:middle\+|middle[\s-]*plus|мидл\+)(?=$|[^\p{L}])/iu.test(value)) {
    return {
      level: 'middle_plus',
      confidence: 'high',
      source: 'title',
      signal: 'middle_plus_title',
      high_level: false,
    };
  }

  if (/(?:^|[^\p{L}])(?:middle|mid[\s-]*level|мидл\p{L}*)(?=$|[^\p{L}])/iu.test(value)) {
    return {
      level: 'middle',
      confidence: 'high',
      source: 'title',
      signal: 'middle_title',
      high_level: false,
    };
  }

  return {
    level: 'unknown',
    confidence: 'low',
    source: 'not_found',
    signal: null,
    high_level: false,
  };
}

function explicitHighLevelRequirement(description) {
  const value = normalizeText(description);
  const patterns = [
    { level: 'senior', regex: /(?:ищем|позици\p{L}*|уров(?:ень|ня)|level)[^.!?\n]{0,50}(?:senior|сеньор|старш\p{L}*)/iu },
    { level: 'lead', regex: /(?:ищем|позици\p{L}*|уров(?:ень|ня)|level)[^.!?\n]{0,50}(?:lead|лид|ведущ\p{L}*)/iu },
    { level: 'principal', regex: /(?:ищем|позици\p{L}*|level)[^.!?\n]{0,50}principal/iu },
    { level: 'staff', regex: /(?:ищем|позици\p{L}*|level)[^.!?\n]{0,50}staff/iu },
  ];

  return patterns.find((item) => item.regex.test(value)) ?? null;
}

function classifyLevel(vacancy) {
  if (
    vacancy.hard_filter_decision &&
    vacancy.hard_filter_decision !== 'PASS'
  ) {
    return decision(
      'REVIEW',
      'review_hard_filter_not_passed',
      ['Item reached Level Filter without a Hard Filter PASS'],
    );
  }

  const titleEvidence = titleLevelEvidence(vacancy.title);
  const experience = experienceEvidence(vacancy);
  const highRequirement = explicitHighLevelRequirement(vacancy.description);
  const prefilterLevels = stringArray(vacancy.matched_level_categories)
    .map((item) => item.toUpperCase());
  const prefilterRisk = normalizeText(vacancy.seniority_risk_hint);

  if (titleEvidence.high_level) {
    return {
      ...decision(
        'REJECT',
        `reject_explicit_${titleEvidence.level}_title`,
        [`Title explicitly requires ${titleEvidence.level} level`],
      ),
      inferred_level: titleEvidence.level,
      level_confidence: 'high',
      title_evidence: titleEvidence,
      experience,
    };
  }

  if (highRequirement) {
    return {
      ...decision(
        'REJECT',
        `reject_explicit_${highRequirement.level}_requirement`,
        [`Description explicitly requires ${highRequirement.level} level`],
      ),
      inferred_level: highRequirement.level,
      level_confidence: 'high',
      title_evidence: titleEvidence,
      experience,
    };
  }

  if (experience.min_years !== null && experience.min_years >= 5) {
    return {
      ...decision(
        'REJECT',
        'reject_minimum_five_years',
        [`Minimum experience requirement is ${experience.min_years} years`],
      ),
      inferred_level: 'senior',
      level_confidence: experience.confidence,
      title_evidence: titleEvidence,
      experience,
    };
  }

  if (titleEvidence.level === 'junior' || titleEvidence.level === 'intern') {
    return {
      ...decision(
        'PASS',
        `allow_${titleEvidence.level}_role`,
        [`Explicit ${titleEvidence.level} role is within the target range`],
      ),
      inferred_level: titleEvidence.level,
      level_confidence: 'high',
      title_evidence: titleEvidence,
      experience,
    };
  }

  if (titleEvidence.level === 'middle') {
    const isStretch = experience.min_years !== null && experience.min_years >= 3;

    return {
      ...decision(
        isStretch ? 'STRETCH' : 'PASS',
        isStretch ? 'stretch_middle_experience' : 'allow_middle_role',
        [
          isStretch
            ? `Middle role requests ${experience.min_years}+ years`
            : 'Explicit Middle role is within the target range',
        ],
      ),
      inferred_level: 'middle',
      level_confidence: 'high',
      title_evidence: titleEvidence,
      experience,
    };
  }

  if (titleEvidence.level === 'middle_plus') {
    return {
      ...decision(
        'STRETCH',
        'stretch_middle_plus_role',
        ['Middle+ is allowed as a stretch vacancy'],
      ),
      inferred_level: 'middle_plus',
      level_confidence: 'high',
      title_evidence: titleEvidence,
      experience,
    };
  }

  if (experience.min_years !== null && experience.min_years >= 3) {
    return {
      ...decision(
        'STRETCH',
        'stretch_three_to_four_years',
        [`Vacancy requests ${experience.min_years}+ years but is below the hard 5-year cutoff`],
      ),
      inferred_level: experience.min_years >= 4 ? 'middle_plus' : 'middle',
      level_confidence: experience.confidence,
      title_evidence: titleEvidence,
      experience,
    };
  }

  if (experience.min_years === 2) {
    return {
      ...decision(
        'STRETCH',
        'stretch_two_years',
        ['Two years of experience is a reasonable stretch requirement'],
      ),
      inferred_level: 'junior_plus',
      level_confidence: experience.confidence,
      title_evidence: titleEvidence,
      experience,
    };
  }

  if (experience.min_years !== null && experience.min_years <= 1) {
    return {
      ...decision(
        'PASS',
        'allow_entry_experience',
        [`Experience requirement is ${experience.min_years}–1 years`],
      ),
      inferred_level: titleEvidence.level === 'unknown' ? 'junior' : titleEvidence.level,
      level_confidence: experience.confidence,
      title_evidence: titleEvidence,
      experience,
    };
  }

  const prefilterHigh = prefilterLevels.some((item) =>
    ['SENIOR', 'LEAD', 'PRINCIPAL', 'STAFF', 'HEAD', 'ARCHITECT'].includes(item),
  );

  if (prefilterHigh || prefilterRisk === 'high') {
    return {
      ...decision(
        'STRETCH',
        'stretch_unconfirmed_high_level_hint',
        ['High-level RSS hint was not confirmed by the full title or requirements'],
        ['AI scorer should inspect seniority carefully'],
      ),
      inferred_level: 'unknown',
      level_confidence: 'low',
      title_evidence: titleEvidence,
      experience,
    };
  }

  return {
    ...decision(
      'STRETCH',
      'stretch_level_not_specified',
      ['Level is not specified; keep the vacancy for AI evaluation'],
    ),
    inferred_level: 'unknown',
    level_confidence: 'low',
    title_evidence: titleEvidence,
    experience,
  };
}

const inputItem = $input.item;
const vacancy = inputItem?.json ?? {};
const result = classifyLevel(vacancy);
const shouldContinue = result.decision === 'PASS' || result.decision === 'STRETCH';

return {
  ...inputItem,
  json: {
    ...vacancy,

    level_filter_version: LEVEL_FILTER_VERSION,
    level_filter_decision: result.decision,
    level_filter_code: result.code,
    level_filter_passed: shouldContinue,
    should_continue_to_candidate_profile: shouldContinue,

    inferred_level: result.inferred_level ?? 'unknown',
    level_confidence: result.level_confidence ?? 'low',
    required_experience_min_years: result.experience?.min_years ?? null,
    required_experience_max_years: result.experience?.max_years ?? null,
    experience_evidence_source: result.experience?.source ?? 'not_found',
    matched_full_page_experience_signals: result.experience?.signals ?? [],
    level_title_evidence: result.title_evidence ?? null,

    level_filter_reasons: result.reasons,
    level_filter_warnings: result.warnings,
    seniority_filter_applied: true,
  },
};
