/**
 * MARK — Full Vacancy Hard Filter
 * Version: 1.2.0
 *
 * n8n Code node mode: Run Once for Each Item
 *
 * Input: normalized vacancy from "Normalize Habr Vacancy".
 * Output: the same vacancy plus four independent gate results and
 *         PASS / REVIEW / REJECT decision.
 *
 * Fixed policy:
 *   - full remote: allowed from any country/city;
 *   - hybrid/office: allowed only in Tbilisi, Georgia;
 *   - salary is never read and never affects the decision;
 *   - seniority is not filtered here (JH-6 owns it);
 *   - REVIEW is kept for audit but does not continue automatically.
 */

const HARD_FILTER_VERSION = '1.2.0';

function isPresent(value) {
  return value !== null &&
    value !== undefined &&
    !(typeof value === 'string' && value.trim() === '');
}

function text(value) {
  return isPresent(value) ? String(value).trim() : '';
}

function normalizedText(value) {
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

function unique(values) {
  return stringArray(values);
}

function matchesAny(patterns, value) {
  return patterns.some((pattern) => pattern.test(value));
}

function gate(decision, code, reasons = [], warnings = []) {
  return {
    decision,
    code,
    reasons: unique(reasons),
    warnings: unique(warnings),
  };
}

function integrityGate(vacancy) {
  const missing = [];

  if (!isPresent(vacancy.source_id)) missing.push('source_id');
  if (!isPresent(vacancy.url)) missing.push('url');
  if (!isPresent(vacancy.title)) missing.push('title');
  if (!isPresent(vacancy.description)) missing.push('description');

  if (vacancy.normalization_ok !== true || missing.length > 0) {
    return gate(
      'REVIEW',
      'review_normalization_failed',
      ['Vacancy normalization is incomplete'],
      [
        ...stringArray(vacancy.normalization_errors),
        missing.length ? `Missing fields: ${missing.join(', ')}` : null,
      ],
    );
  }

  return gate(
    'PASS',
    'normalization_valid',
    ['Normalized vacancy contract is valid'],
  );
}

function statusGate(vacancy) {
  const status = normalizedText(vacancy.status);

  if (vacancy.archived === true || status === 'archived') {
    return gate(
      'REJECT',
      'reject_vacancy_archived',
      ['Vacancy is archived'],
    );
  }

  if (vacancy.hidden === true || status === 'hidden') {
    return gate(
      'REJECT',
      'reject_vacancy_hidden',
      ['Vacancy is hidden'],
    );
  }

  return gate(
    'PASS',
    'vacancy_active',
    ['Vacancy is active'],
  );
}

function geographyFacts(vacancy) {
  const city = normalizedText(vacancy.city);
  const country = normalizedText(vacancy.country);
  const location = normalizedText([
    vacancy.location,
    ...(Array.isArray(vacancy.locations) ? vacancy.locations : []),
    vacancy.short_geo,
  ].filter(Boolean).join(' '));

  const isTbilisi = vacancy.is_tbilisi === true ||
    /(?:^|[^\p{L}])(?:тбилиси|tbilisi|თბილისი)(?=$|[^\p{L}])/iu.test(
      `${city} ${location}`,
    );

  const explicitGeorgia = vacancy.is_georgia === true ||
    /(?:^|[^\p{L}])(?:грузи(?:я|и)|საქართველო)(?=$|[^\p{L}])/iu.test(
      `${country} ${location}`,
    );

  const englishGeorgia = /(?:^|[^\p{L}])georgia(?=$|[^\p{L}])/iu.test(
    `${country} ${location}`,
  );

  const usGeorgia = /\b(?:usa|u\.s\.a|united states|atlanta|georgia,\s*ga|ga,\s*usa)\b/i.test(
    `${country} ${location}`,
  );

  const isGeorgia = isTbilisi || explicitGeorgia || (englishGeorgia && !usGeorgia);
  const locationKnown = Boolean(city || country || location);

  return {
    city: city || null,
    country: country || null,
    is_tbilisi: isTbilisi,
    is_georgia: isGeorgia,
    location_known: locationKnown,
  };
}

function geoWorkGate(vacancy) {
  const workFormat = normalizedText(vacancy.work_format);
  const confidence = normalizedText(vacancy.work_format_confidence);
  const confidenceAllowed = confidence === 'high' || confidence === 'medium';
  const geography = geographyFacts(vacancy);

  if (vacancy.work_format_conflict === true) {
    return {
      ...gate(
        'REVIEW',
        'review_work_format_conflict',
        ['Work-format evidence is contradictory'],
      ),
      geography,
    };
  }

  if (workFormat === 'remote') {
    if (vacancy.remote_denied === true) {
      return {
        ...gate(
          'REJECT',
          'reject_remote_denied',
          ['The vacancy explicitly denies remote work'],
        ),
        geography,
      };
    }

    if (!confidenceAllowed) {
      return {
        ...gate(
          'REVIEW',
          'review_remote_low_confidence',
          ['Remote format has insufficient confidence'],
        ),
        geography,
      };
    }

    return {
      ...gate(
        'PASS',
        'allow_full_remote',
        ['Confirmed full remote work is allowed regardless of location restrictions'],
      ),
      geography,
    };
  }

  if (workFormat === 'hybrid' || workFormat === 'office') {
    const label = workFormat === 'hybrid' ? 'Hybrid' : 'Office';

    if (geography.is_tbilisi && geography.is_georgia) {
      if (!confidenceAllowed) {
        return {
          ...gate(
            'REVIEW',
            `review_${workFormat}_tbilisi_low_confidence`,
            [`${label} in Tbilisi is possible, but format confidence is low`],
          ),
          geography,
        };
      }

      return {
        ...gate(
          'PASS',
          `allow_${workFormat}_tbilisi`,
          [`${label} work is allowed in Tbilisi, Georgia`],
        ),
        geography,
      };
    }

    if (geography.is_tbilisi && !geography.is_georgia) {
      return {
        ...gate(
          'REVIEW',
          'review_tbilisi_country_unconfirmed',
          ['Tbilisi is detected, but Georgia is not confirmed'],
        ),
        geography,
      };
    }

    if (!geography.location_known || (geography.is_georgia && !geography.city)) {
      return {
        ...gate(
          'REVIEW',
          'review_tbilisi_not_confirmed',
          [`${label} work requires a confirmed Tbilisi location`],
        ),
        geography,
      };
    }

    return {
      ...gate(
        'REJECT',
        `reject_${workFormat}_outside_tbilisi`,
        [`${label} work outside Tbilisi is not allowed by the search policy`],
      ),
      geography,
    };
  }

  if (!workFormat || workFormat === 'unknown') {
    return {
      ...gate(
        'REVIEW',
        'review_work_format_unknown',
        ['Work format is not confirmed'],
      ),
      geography,
    };
  }

  return {
    ...gate(
      'REVIEW',
      'review_work_format_unsupported',
      [`Unsupported work format: ${workFormat}`],
    ),
    geography,
  };
}

function fullPageRoleEvidence(vacancy) {
  const title = normalizedText(vacancy.title);
  const description = normalizedText(vacancy.description);
  const skills = normalizedText(stringArray(vacancy.skills).join(' '));
  const searchable = `${title} ${description} ${skills}`;

  const targetTitlePatterns = [
    /\b(?:ai|llm|gen[\s-]*ai|rag|nlp|ml)[\s-]*(?:engineer|developer|разработчик|инженер)\b/i,
    /\b(?:machine learning|artificial intelligence)[\s-]*(?:engineer|developer)\b/i,
    /(?:инженер|разработчик)[^\n]{0,60}(?:\bai\b|\bllm\b|\bии\b|искусственн\p{L}*\s+интеллект)/iu,
    /(?:\bai\b|\bllm\b|\bии\b|генеративн\p{L}*)[^\n]{0,60}(?:инженер|разработчик)/iu,
    /\bprompt[\s-]*(?:engineer|developer)\b/i,
    /промпт[\s-]*инженер/iu,
    /\bdata scientist\b/i,
    /\bmlops\b|\bllmops\b/i,
  ];

  const absoluteOffTargetPatterns = [
    /\b(?:recruiter|talent acquisition|sales manager|marketing manager|customer success)\b/i,
    /(?:рекрутер|менеджер\s+по\s+продаж|маркетолог|hr[\s-]*менеджер|кадров)/iu,
    /\b(?:product|project|account)[\s-]*manager\b/i,
    /(?:продуктов\p{L}*|проектн\p{L}*)\s+менеджер/iu,
    /(?:бизнес|системн|data|данн\p{L}*)[\s-]*аналитик/iu,
    /\b(?:ux|ui)[\s/+-]*designer\b/i,
    /(?:дизайнер|техническ\p{L}*\s+поддержк)/iu,
  ];

  const technicalOffTargetPatterns = [
    /\bfrontend\b|\bfront[\s-]*end\b/i,
    /\b(?:ios|android|mobile)[\s-]*(?:developer|engineer)\b/i,
    /\b(?:qa|test)[\s-]*(?:engineer|automation)\b/i,
    /\b(?:php|1c|битрикс)[\s-]*(?:developer|разработчик)?\b/iu,
    /\bdevops\b/i,
  ];

  const coreAiPatterns = [
    { name: 'develop_ai_systems', regex: /(?:разрабаты|созда|проектир|стро|внедря|develop|build|design|implement)[^.!?\n]{0,100}(?:\bai\b|\bии\b|\bllm\b|rag|генеративн\p{L}*\s+(?:ии|модел)|искусственн\p{L}*\s+интеллект)/iu },
    { name: 'develop_ai_agents', regex: /(?:разрабаты|созда|проектир|стро|develop|build|design)[^.!?\n]{0,100}(?:ai[\s-]*agent|ии[\s-]*агент|агентн\p{L}*\s+систем)/iu },
    { name: 'build_rag', regex: /(?:разрабаты|созда|проектир|стро|develop|build|design|implement)[^.!?\n]{0,100}\brag\b/iu },
    { name: 'integrate_llm', regex: /(?:интегрир|подключ|integrat|orchestrat)[^.!?\n]{0,100}(?:\bllm\b|\bai\b|модел|agent)/iu },
    { name: 'train_models', regex: /(?:обуч|дообуч|fine[\s-]*tun|train)[^.!?\n]{0,100}(?:модел|\bllm\b|нейросет|model)/iu },
    { name: 'model_inference', regex: /(?:inference|инференс|model serving|обслуживан\p{L}*\s+модел)/iu },
    { name: 'evaluate_llm', regex: /(?:оценк|тестир|evaluat)[^.!?\n]{0,100}(?:\bllm\b|ai[\s-]*систем|модел)/iu },
  ];

  const implementationPatterns = [
    { name: 'LangChain', regex: /\blangchain\b/i },
    { name: 'LangGraph', regex: /\blanggraph\b/i },
    { name: 'LlamaIndex', regex: /\bllamaindex\b/i },
    { name: 'CrewAI', regex: /\bcrewai\b/i },
    { name: 'AutoGen', regex: /\bautogen\b/i },
    { name: 'RAG', regex: /\brag\b/i },
    { name: 'LLM', regex: /\bllm\b/i },
    { name: 'MCP', regex: /\bmcp\b/i },
    { name: 'Embeddings', regex: /\bembeddings?\b/i },
    { name: 'Vector Search', regex: /\bvector (?:database|search|db)\b/i },
    {
      name: 'Vector Database',
      regex: /\b(?:qdrant|faiss|chroma|pinecone|weaviate|milvus|pgvector)\b/i,
    },
    {
      name: 'AI Provider API',
      regex: /\b(?:openai|anthropic|nvidia|gemini)[\s-]*(?:api|nim)?\b/i,
    },
  ];

  const coreSignals = coreAiPatterns
    .filter((pattern) => pattern.regex.test(description))
    .map((pattern) => pattern.name);

  const implementationSignals = implementationPatterns
    .filter((pattern) => pattern.regex.test(searchable))
    .map((pattern) => pattern.name);

  return {
    target_title: matchesAny(targetTitlePatterns, title),
    absolute_off_target_title: matchesAny(absoluteOffTargetPatterns, title),
    technical_off_target_title: matchesAny(technicalOffTargetPatterns, title),
    core_ai_signals: unique(coreSignals),
    implementation_signals: unique(implementationSignals),
  };
}

function roleGate(vacancy) {
  const prefilterDecision = text(vacancy.prefilter_decision).toUpperCase();
  const roleClass = normalizedText(vacancy.title_role_class);
  const targetTier = text(vacancy.target_role_tier).toUpperCase();

  const targetRoles = stringArray(vacancy.matched_target_roles);
  const adjacentRoles = stringArray(vacancy.matched_adjacent_roles);
  const absoluteOffTarget = stringArray(vacancy.matched_absolute_off_target_roles);
  const softOffTarget = stringArray(vacancy.matched_soft_off_target_roles);
  const stackOffTarget = stringArray(vacancy.matched_stack_off_target_roles);
  const prefilterCore = stringArray(vacancy.matched_core_ai_work_signals);
  const substantiveAi = stringArray(vacancy.matched_substantive_ai_categories);
  const prefilterImplementation = stringArray(vacancy.matched_ai_implementation_signals);
  const fullPage = fullPageRoleEvidence(vacancy);

  const coreSignals = unique([prefilterCore, fullPage.core_ai_signals]);
  const implementationSignals = unique([
    prefilterImplementation,
    fullPage.implementation_signals,
  ]);

  const hasTargetEvidence =
    targetRoles.length > 0 ||
    roleClass === 'target' ||
    fullPage.target_title;

  const hasAdjacentEvidence =
    adjacentRoles.length > 0 ||
    roleClass === 'adjacent';

  const hasCoreAiWork = coreSignals.length > 0;
  const hasSubstantiveAi = substantiveAi.length > 0 || implementationSignals.length >= 2;
  const hasAbsoluteOffTarget = absoluteOffTarget.length > 0 || fullPage.absolute_off_target_title;
  const hasTechnicalOffTarget =
    softOffTarget.length > 0 ||
    stackOffTarget.length > 0 ||
    fullPage.technical_off_target_title;

  const evidence = {
    role_class: roleClass || 'unknown',
    target_tier: targetTier || null,
    target_roles: targetRoles,
    adjacent_roles: adjacentRoles,
    absolute_off_target_roles: absoluteOffTarget,
    soft_off_target_roles: softOffTarget,
    stack_off_target_roles: stackOffTarget,
    core_ai_signals: coreSignals,
    substantive_ai_categories: substantiveAi,
    implementation_signals: implementationSignals,
  };

  if (prefilterDecision === 'REJECT') {
    return {
      ...gate(
        'REJECT',
        'reject_prefilter_rejected_role',
        ['The vacancy was classified as irrelevant by the RSS pre-filter'],
      ),
      evidence,
    };
  }

  if (hasAbsoluteOffTarget) {
    return {
      ...gate(
        'REJECT',
        'reject_absolute_off_target_role',
        ['Vacancy title belongs to a non-target profession'],
      ),
      evidence,
    };
  }

  if (hasTechnicalOffTarget && !hasTargetEvidence && !hasCoreAiWork) {
    return {
      ...gate(
        'REJECT',
        'reject_technical_off_target_without_ai_work',
        ['Technical role has no confirmed core AI engineering work'],
      ),
      evidence,
    };
  }

  if (hasTechnicalOffTarget && hasCoreAiWork && !hasTargetEvidence) {
    return {
      ...gate(
        'REVIEW',
        'review_technical_off_target_with_ai_work',
        ['Non-target technical title contains substantive AI engineering work'],
      ),
      evidence,
    };
  }

  if (hasTargetEvidence && (hasSubstantiveAi || hasCoreAiWork)) {
    return {
      ...gate(
        'PASS',
        'allow_target_ai_role',
        ['Target AI role with substantive AI evidence'],
      ),
      evidence,
    };
  }

  if (hasAdjacentEvidence && (hasCoreAiWork || hasSubstantiveAi)) {
    return {
      ...gate(
        'PASS',
        'allow_adjacent_role_with_ai_work',
        ['Adjacent role contains substantive AI engineering work'],
      ),
      evidence,
    };
  }

  if (prefilterDecision === 'PASS' && (hasCoreAiWork || hasSubstantiveAi)) {
    return {
      ...gate(
        'PASS',
        'allow_prefilter_confirmed_ai_role',
        ['Pre-filter PASS is supported by full-vacancy AI evidence'],
      ),
      evidence,
    };
  }

  if (prefilterDecision === 'REVIEW' || hasCoreAiWork || hasSubstantiveAi) {
    return {
      ...gate(
        'REVIEW',
        'review_ambiguous_ai_role',
        ['AI relevance exists, but the profession remains ambiguous'],
      ),
      evidence,
    };
  }

  return {
    ...gate(
      'REJECT',
      'reject_no_substantive_ai_role_evidence',
      ['No substantive AI engineering role evidence was confirmed'],
    ),
    evidence,
  };
}

function aggregateGates(gates) {
  const values = Object.values(gates);
  const rejected = values.find((item) => item.decision === 'REJECT');
  const review = values.find((item) => item.decision === 'REVIEW');
  const primary = rejected ?? review;

  return {
    decision: rejected ? 'REJECT' : review ? 'REVIEW' : 'PASS',
    code: primary?.code ?? 'allow_all_hard_filter_gates',
    reasons: unique(values.flatMap((item) => item.reasons)),
    warnings: unique(values.flatMap((item) => item.warnings)),
  };
}

const inputItem = $input.item;
const vacancy = inputItem?.json ?? {};

const gates = {
  integrity: integrityGate(vacancy),
  status: statusGate(vacancy),
  geo_work: geoWorkGate(vacancy),
  role: roleGate(vacancy),
};

const result = aggregateGates(gates);
const hardFilterPassed = result.decision === 'PASS';

return {
  ...inputItem,
  json: {
    ...vacancy,

    hard_filter_version: HARD_FILTER_VERSION,
    hard_filter_decision: result.decision,
    hard_filter_code: result.code,
    hard_filter_passed: hardFilterPassed,
    should_continue_to_level_filter: hardFilterPassed,
    hard_filter_reasons: result.reasons,
    hard_filter_warnings: result.warnings,

    hard_filter_integrity_gate: gates.integrity,
    hard_filter_status_gate: gates.status,
    hard_filter_geo_work_gate: gates.geo_work,
    hard_filter_role_gate: gates.role,

    salary_filter_applied: false,
  },
};
