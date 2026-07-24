/**
 * MARK — HeadHunter Search Result Pre-filter
 * Version: 1.0.0
 * n8n Code node mode: Run Once for Each Item
 *
 * Only explicit Senior+/5+ and clearly off-target roles are rejected here.
 * Ambiguous results remain REVIEW so useful vacancies are not lost before the
 * full vacancy contract is available.
 */

const HH_PREFILTER_VERSION = '1.0.0';

function text(value) {
  return String(value ?? '').trim();
}

function normalized(value) {
  return text(value)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
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

const inputItem = $input.item;
const vacancy = inputItem?.json ?? {};
const title = normalized(vacancy.title);
const snippet = normalized(vacancy.description_snippet);
const searchable = `${title} ${snippet}`;

const highLevelSignals = [
  { name: 'Senior', regex: /(?:^|[^\p{L}])(?:senior|sr\.?|сеньор|старш\p{L}*)(?=$|[^\p{L}])/iu },
  { name: 'Lead', regex: /(?:^|[^\p{L}])(?:lead|team[\s-]*lead|tech[\s-]*lead|лид|ведущ\p{L}*)(?=$|[^\p{L}])/iu },
  { name: 'Principal', regex: /(?:^|[^\p{L}])principal(?=$|[^\p{L}])/iu },
  { name: 'Staff', regex: /(?:^|[^\p{L}])staff(?=$|[^\p{L}])/iu },
  { name: 'Head', regex: /(?:^|[^\p{L}])(?:head|руководител\p{L}*)(?=$|[^\p{L}])/iu },
  { name: 'Architect', regex: /(?:^|[^\p{L}])(?:architect|архитектор\p{L}*)(?=$|[^\p{L}])/iu },
];

const offTargetSignals = [
  { name: 'Product Manager', regex: /\b(?:product|project|account)[\s-]*manager\b|(?:продуктов\p{L}*|проектн\p{L}*)\s+менеджер/iu },
  { name: 'Sales/Marketing', regex: /\b(?:sales|marketing)[\s-]*(?:manager|specialist)\b|(?:продаж|маркетолог|маркетинг)/iu },
  { name: 'Recruiting/HR', regex: /\b(?:recruiter|talent acquisition|hr[\s-]*manager)\b|(?:рекрутер|кадров)/iu },
  { name: 'Analyst', regex: /(?:бизнес|системн|data|данн\p{L}*)[\s-]*аналитик|\b(?:business|system|data)[\s-]*analyst\b/iu },
  { name: 'Design/Support', regex: /\b(?:ux|ui)[\s/+-]*designer\b|(?:дизайнер|техническ\p{L}*\s+поддержк)/iu },
];

const targetSignals = [
  { name: 'AI Engineer', regex: /\b(?:ai|llm|gen[\s-]*ai|rag|nlp|ml)[\s-]*(?:engineer|developer)\b|(?:инженер|разработчик)[^\n]{0,50}(?:\bии\b|\bai\b|\bllm\b|ml)/iu },
  { name: 'Machine Learning Engineer', regex: /\b(?:machine learning|artificial intelligence)[\s-]*(?:engineer|developer)\b/iu },
  { name: 'Prompt Engineer', regex: /\bprompt[\s-]*(?:engineer|developer)\b|промпт[\s-]*инженер/iu },
  { name: 'Data Scientist', regex: /\bdata scientist\b|дат[аa][\s-]*сайентист/iu },
  { name: 'MLOps/LLMOps', regex: /\b(?:mlops|llmops)\b/iu },
];

const adjacentSignals = [
  { name: 'Python Developer', regex: /\bpython[\s-]*(?:developer|engineer)\b|(?:python)[\s-]*разработчик/iu },
  { name: 'Backend Developer', regex: /\bback[\s-]*end[\s-]*(?:developer|engineer)\b|backend[\s-]*разработчик/iu },
  { name: 'Automation Engineer', regex: /\bautomation[\s-]*engineer\b|инженер[^\n]{0,30}автоматизац/iu },
];

const aiSignals = [
  { name: 'LLM', regex: /\bllms?\b|large language model|языков\p{L}*\s+модел/iu },
  { name: 'RAG', regex: /(?:^|[^a-z0-9_])rag(?:$|[^a-z0-9_])|retrieval[\s-]*augmented/iu },
  { name: 'AI Agents', regex: /\bai[\s-]*agents?\b|ии[\s-]*агент|агентн\p{L}*\s+систем/iu },
  { name: 'Generative AI', regex: /\bgen[\s-]*ai\b|generative[\s-]*ai|генеративн\p{L}*\s+(?:ии|модел)/iu },
  { name: 'Machine Learning', regex: /\bmachine learning\b|машинн\p{L}*\s+обучен/iu },
  { name: 'NLP', regex: /(?:^|[^a-z0-9_])nlp(?:$|[^a-z0-9_])|natural language processing/iu },
  { name: 'AI implementation', regex: /\b(?:langchain|langgraph|llamaindex|crewai|autogen|qdrant|embeddings?|vector database|openai|anthropic)\b/iu },
];

const high = highLevelSignals.filter((item) => item.regex.test(title)).map((item) => item.name);
const offTarget = offTargetSignals.filter((item) => item.regex.test(title)).map((item) => item.name);
const target = targetSignals.filter((item) => item.regex.test(title)).map((item) => item.name);
const adjacent = adjacentSignals.filter((item) => item.regex.test(title)).map((item) => item.name);
const ai = aiSignals.filter((item) => item.regex.test(searchable)).map((item) => item.name);
const experience = experienceHint(vacancy.hh_preview_experience_id);

let decision = 'REVIEW';
let code = 'review_ambiguous_hh_search_result';
let reasons = ['Search result requires full vacancy inspection'];

if (high.length > 0) {
  decision = 'REJECT';
  code = 'reject_explicit_senior_plus_title';
  reasons = [`Explicit high-level title: ${high.join(', ')}`];
} else if (experience.min !== null && experience.min >= 5) {
  decision = 'REJECT';
  code = 'reject_confirmed_5_plus_experience';
  reasons = [`HH experience category requires at least ${experience.min} years`];
} else if (offTarget.length > 0) {
  decision = 'REJECT';
  code = 'reject_explicit_off_target_title';
  reasons = [`Explicit off-target title: ${offTarget.join(', ')}`];
} else if (target.length > 0) {
  decision = 'PASS';
  code = 'pass_target_ai_title';
  reasons = [`Target role title: ${target.join(', ')}`];
} else if (adjacent.length > 0 && ai.length > 0) {
  decision = 'REVIEW';
  code = 'review_adjacent_role_with_ai_evidence';
  reasons = ['Adjacent engineering title contains AI evidence'];
} else if (ai.length > 0) {
  decision = 'REVIEW';
  code = 'review_ai_evidence_unknown_role';
  reasons = ['AI evidence exists, but the role title is ambiguous'];
}

return {
  ...inputItem,
  json: {
    ...vacancy,
    prefilter_version: HH_PREFILTER_VERSION,
    prefilter_decision: decision,
    prefilter_code: code,
    prefilter_reasons: reasons,
    prefilter_warnings: [],
    title_role_class: target.length > 0
      ? 'target'
      : adjacent.length > 0
        ? 'adjacent'
        : offTarget.length > 0
          ? 'off_target'
          : 'unknown',
    target_role_tier: target.length > 0 ? 'A' : adjacent.length > 0 ? 'B' : null,
    matched_target_roles: unique(target),
    matched_adjacent_roles: unique(adjacent),
    matched_absolute_off_target_roles: unique(offTarget),
    matched_soft_off_target_roles: [],
    matched_stack_off_target_roles: [],
    matched_core_ai_work_signals: unique(ai),
    matched_substantive_ai_categories: unique(ai),
    matched_ai_implementation_signals: unique(ai.filter((item) => item === 'AI implementation')),
    matched_level_categories: unique(high),
    matched_experience_signals: vacancy.hh_preview_experience_name
      ? [vacancy.hh_preview_experience_name]
      : [],
    experience_min_years_hint: experience.min,
    experience_max_years_hint: experience.max,
    should_fetch_full_vacancy: decision === 'PASS' || decision === 'REVIEW',
    salary_filter_applied: false,
  },
};
