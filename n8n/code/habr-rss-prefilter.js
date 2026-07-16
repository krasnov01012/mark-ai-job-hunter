/**
 * MARK — Habr Career RSS Pre-filter / Classifier
 * Version: 4.0.0-ultimate
 * n8n Code node mode: Run Once for All Items
 *
 * IMPORTANT ARCHITECTURE:
 * - This node returns ALL RSS items for auditability.
 * - Every item gets PASS / REVIEW / REJECT.
 * - Put an n8n Filter node after this node:
 *     should_fetch_full_page is true
 * - Then keep Dev Limit during development.
 *
 * Why:
 * - We do not silently destroy rejected vacancies.
 * - We can inspect false positives / false negatives later.
 * - PASS + REVIEW go to full-page fetch; REJECT stays visible in execution data.
 *
 * Salary is intentionally ignored.
 * Work-location policy is only hinted here; final enforcement belongs to JH-5:
 * - full remote: allowed anywhere
 * - hybrid: allowed only in Tbilisi, Georgia
 * - office: allowed only in Tbilisi, Georgia
 */

const items = $input.all();

const PREFILTER_VERSION = '4.0.0-ultimate';

// ============================================================
// 1. GENERIC HELPERS
// ============================================================

function decodeHtmlEntities(value) {
  return String(value ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(parseInt(code, 16))
    );
}

function htmlToPlainText(value) {
  return decodeHtmlEntities(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeText(value) {
  return htmlToPlainText(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[–—−]/g, '-')
    .replace(/[“”„«»]/g, '"')
    .replace(/[’‘`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function uniqueBy(values, keyFn) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const key = keyFn(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }

  return result;
}

function matchPatterns(patterns, text) {
  if (!text) return [];
  return patterns.filter((pattern) => pattern.regex.test(text));
}

function names(matches) {
  return uniq(matches.map((match) => match.name));
}

function categories(matches) {
  return uniq(matches.map((match) => match.category));
}

function hasAny(patterns, text) {
  if (!text) return false;
  return patterns.some((pattern) => (pattern.regex ?? pattern).test(text));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function countIntersection(values, set) {
  return values.filter((value) => set.has(value)).length;
}

function bestTier(tiers) {
  if (tiers.includes('A')) return 'A';
  if (tiers.includes('B')) return 'B';
  if (tiers.includes('C')) return 'C';
  return null;
}

function decisionRank(decision) {
  if (decision === 'PASS') return 0;
  if (decision === 'REVIEW') return 1;
  return 2;
}

// ============================================================
// 2. HABR RSS STRUCTURE PARSER
// ============================================================

/**
 * Habr RSS usually looks like:
 * "Компания «X» ищет хорошего специалиста на вакансию «Y».
 *  Полный рабочий день. Можно удалённо.
 *  Требуемые навыки: #Python, #LLM, #LangGraph."
 *
 * We parse structured hints instead of treating the whole text as one blob.
 */
function extractVacancyTitle(rawTitle, rawContent) {
  const title = htmlToPlainText(rawTitle).trim();
  const content = htmlToPlainText(rawContent).trim();

  const titlePatterns = [
    /^требуется\s+[«"](.+?)[»"]\s*$/iu,
    /^вакансия\s+[«"](.+?)[»"]\s*$/iu,
    /^ищем\s+[«"]?(.+?)[»"]?\s*$/iu,
  ];

  for (const pattern of titlePatterns) {
    const match = title.match(pattern);
    if (match?.[1]) return match[1].trim();
  }

  const contentMatch = content.match(
    /(?:на\s+ваканси(?:ю|и)|вакансия)\s+[«"](.+?)[»"]/iu
  );

  if (contentMatch?.[1]) return contentMatch[1].trim();

  return title;
}

function extractRssSkills(rawContent) {
  const text = htmlToPlainText(rawContent);

  const markers = [
    /требуемые\s+навыки\s*:\s*([^\n]+)$/iu,
    /навыки\s*:\s*([^\n]+)$/iu,
    /required\s+skills\s*:\s*([^\n]+)$/iu,
  ];

  let skillsPart = null;

  for (const marker of markers) {
    const match = text.match(marker);
    if (match?.[1]) {
      skillsPart = match[1].trim();
      break;
    }
  }

  if (!skillsPart) return [];

  skillsPart = skillsPart.replace(/[.!?]+\s*$/u, '').trim();

  return uniq(
    skillsPart
      .split(/\s*,\s*/u)
      .map((skill) => skill.replace(/^#+/u, '').trim())
      .filter(Boolean)
  );
}

function extractRssNarrative(rawContent) {
  let text = htmlToPlainText(rawContent);

  // Remove the skills tail so skills can be weighted separately.
  text = text.replace(
    /(?:требуемые\s+навыки|required\s+skills|навыки)\s*:[\s\S]*$/iu,
    ' '
  );

  // Remove common Habr boilerplate with company/title duplication.
  text = text.replace(
    /^компания\s+[«"].+?[»"]\s+ищет\s+хорошего\s+специалиста\s+на\s+вакансию\s+[«"].+?[»"]\.?\s*/iu,
    ' '
  );

  return normalizeText(text);
}

function parseHabrRss(itemJson) {
  const rawTitle = String(itemJson.title ?? '');
  const rawContent = String(itemJson.content ?? itemJson.contentSnippet ?? '');

  const vacancyTitle = extractVacancyTitle(rawTitle, rawContent);
  const skills = extractRssSkills(rawContent);

  return {
    vacancy_title_raw: vacancyTitle,
    vacancy_title_normalized: normalizeText(vacancyTitle),
    rss_skills: skills,
    rss_skills_normalized: skills.map(normalizeText),
    rss_skills_text: normalizeText(skills.join(' ')),
    rss_narrative_text: extractRssNarrative(rawContent),
    rss_full_text: normalizeText(rawContent),
  };
}

// ============================================================
// 3. ROLE TAXONOMY
// ============================================================

/**
 * Target role tiers are personalized for MARK's current goal.
 *
 * Tier A — closest to the user's profile and desired direction.
 * Tier B — relevant AI engineering.
 * Tier C — relevant but less aligned; should not be lost.
 */
const targetRolePatterns = [
  // ---------------- Tier A ----------------
  { tier: 'A', category: 'AI_ENGINEERING', name: 'AI Engineer', regex: /\bai[\s-]*(?:engineer|developer)\b/i },
  { tier: 'A', category: 'AI_ENGINEERING', name: 'AI инженер/разработчик', regex: /(?:^|[^\p{L}\p{N}_])(?:ai|ии)[\s-]*(?:инженер|разработчик)(?:$|[^\p{L}\p{N}_])/iu },
  { tier: 'A', category: 'AI_ENGINEERING', name: 'Инженер по ИИ', regex: /инженер\p{L}*\s+по\s+(?:искусственн\p{L}*\s+интеллект|ии)/iu },
  { tier: 'A', category: 'AI_ENGINEERING', name: 'Applied AI Engineer', regex: /\bapplied[\s-]*ai[\s-]*(?:engineer|developer)\b/i },
  { tier: 'A', category: 'AI_ENGINEERING', name: 'AI/ML Engineer', regex: /\bai\s*[\/-]\s*ml[\s-]*(?:engineer|developer)\b|\bml\s*[\/-]\s*ai[\s-]*(?:engineer|developer)\b/i },
  { tier: 'A', category: 'AI_ENGINEERING', name: 'Инженер/разработчик AI/ИИ', regex: /(?:инженер|разработчик)[\s-]*(?:ai|(?<![\p{L}\p{N}_])ии(?![\p{L}\p{N}_]))/iu },
  { tier: 'A', category: 'AI_ENGINEERING', name: 'AI Solutions Engineer', regex: /\bai[\s-]*(?:solutions?|applications?|integration|automation|backend|platform)[\s-]*(?:engineer|developer)\b/i },
  { tier: 'A', category: 'AI_ENGINEERING', name: 'Conversational AI Engineer', regex: /\bconversational[\s-]*ai[\s-]*(?:engineer|developer)\b/i },
  { tier: 'A', category: 'AI_ENGINEERING', name: 'Agentic AI Engineer', regex: /\bagentic[\s-]*ai[\s-]*(?:engineer|developer)\b/i },
  { tier: 'A', category: 'LLM_ENGINEERING', name: 'LLM Engineer', regex: /\bllm[\s-]*(?:engineer|developer)\b/i },
  { tier: 'A', category: 'LLM_ENGINEERING', name: 'LLM инженер/разработчик', regex: /(?:^|[^\p{L}\p{N}_])(?:llm[\s-]*(?:инженер|разработчик)|(?:инженер|разработчик)[\s-]*llm)(?:$|[^\p{L}\p{N}_])/iu },
  { tier: 'A', category: 'GENAI_ENGINEERING', name: 'GenAI Engineer', regex: /\b(?:gen[\s-]*ai|generative[\s-]*ai)[\s-]*(?:engineer|developer)\b/i },
  { tier: 'A', category: 'AGENT_ENGINEERING', name: 'AI Agent Engineer', regex: /\bai[\s-]*agents?[\s-]*(?:engineer|developer)\b/i },
  { tier: 'A', category: 'AGENT_ENGINEERING', name: 'AI-агент инженер/разработчик', regex: /(?:^|[^\p{L}\p{N}_])(?:ai|ии)[\s-]*агент\p{L}*[\s-]*(?:инженер|разработчик)(?:$|[^\p{L}\p{N}_])/iu },
  { tier: 'A', category: 'RAG_ENGINEERING', name: 'RAG Engineer', regex: /(?:^|[^\p{L}\p{N}_])rag[\s-]*(?:engineer|developer|инженер|разработчик)(?:$|[^\p{L}\p{N}_])/iu },
  { tier: 'A', category: 'PROMPT_ENGINEERING', name: 'Prompt Engineer', regex: /\bprompt[\s-]*(?:engineer|engineering)\b|промпт[\s-]*(?:инженер|инжиниринг)/iu },
  { tier: 'A', category: 'LLMOPS', name: 'LLMOps Engineer', regex: /\bllm[\s-]*ops(?:[\s-]*(?:engineer|developer))?\b/i },
  { tier: 'A', category: 'INFERENCE', name: 'LLM/Inference Engineer', regex: /\b(?:llm[\s-]*)?inference[\s-]*(?:engineer|developer)\b/i },

  // ---------------- Tier B ----------------
  { tier: 'B', category: 'NLP_ENGINEERING', name: 'NLP Engineer', regex: /(?:^|[^\p{L}\p{N}_])nlp[\s-]*(?:engineer|developer|инженер|разработчик)(?:$|[^\p{L}\p{N}_])/iu },
  { tier: 'B', category: 'ML_ENGINEERING', name: 'ML Engineer', regex: /\bml[\s-]*(?:engineer|developer)\b/i },
  { tier: 'B', category: 'ML_ENGINEERING', name: 'Machine Learning Engineer', regex: /\bmachine learning[\s-]*(?:engineer|developer)\b/i },
  { tier: 'B', category: 'ML_ENGINEERING', name: 'Applied ML Engineer', regex: /\bapplied[\s-]*(?:ml|machine learning)[\s-]*(?:engineer|developer)\b/i },
  { tier: 'B', category: 'ML_ENGINEERING', name: 'ML инженер/разработчик', regex: /(?:^|[^\p{L}\p{N}_])(?:ml[\s-]*(?:инженер|разработчик)|(?:инженер|разработчик)[\s-]*ml)(?:$|[^\p{L}\p{N}_])/iu },
  { tier: 'B', category: 'ML_ENGINEERING', name: 'Инженер машинного обучения', regex: /инженер\p{L}*\s+(?:по\s+)?машинн\p{L}*\s+обучен/iu },
  { tier: 'B', category: 'NEURAL_ENGINEERING', name: 'Разработчик нейросетей', regex: /(?:разработчик|инженер)\p{L}*\s+(?:нейросет|нейронн\p{L}*\s+сет)/iu },
  { tier: 'B', category: 'RESEARCH_AI', name: 'AI Research Engineer', regex: /\b(?:ai|machine learning)[\s-]*(?:research engineer|researcher|research scientist)\b/i },

  // ---------------- Tier C ----------------
  { tier: 'C', category: 'MLOPS', name: 'MLOps Engineer', regex: /\bml[\s-]*ops(?:[\s-]*(?:engineer|developer))?\b/i },
  { tier: 'C', category: 'AIOPS', name: 'AIOps Engineer', regex: /\bai[\s-]*ops(?:[\s-]*(?:engineer|developer))?\b/i },
  { tier: 'C', category: 'SPEECH_AI', name: 'Speech/ASR Engineer', regex: /\b(?:speech|asr|stt|tts)[\s-]*(?:engineer|developer)\b/i },
  { tier: 'C', category: 'COMPUTER_VISION', name: 'Computer Vision Engineer', regex: /\b(?:computer vision|cv)[\s-]*(?:engineer|developer)\b/i },
];

const adjacentRolePatterns = [
  { category: 'PYTHON_BACKEND', name: 'Python Developer', regex: /(?:^|[^\p{L}\p{N}_])(?:python[\s-]*(?:developer|engineer|разработчик|инженер)|(?:разработчик|инженер)[\s-]*python)(?:$|[^\p{L}\p{N}_])/iu },
  { category: 'BACKEND', name: 'Backend Engineer', regex: /\bback[\s-]*end[\s-]*(?:developer|engineer)\b|бекенд|бэкенд|backend/iu },
  { category: 'FULLSTACK', name: 'Fullstack Developer', regex: /\bfull[\s-]*stack[\s-]*(?:developer|engineer)\b/i },
  { category: 'SOFTWARE_ENGINEERING', name: 'Software Engineer', regex: /\bsoftware[\s-]*(?:engineer|developer)\b/i },
  { category: 'AUTOMATION', name: 'Automation Engineer', regex: /\bautomation[\s-]*(?:engineer|developer)\b/i },
  { category: 'DATA_SCIENCE', name: 'Data Scientist', regex: /\bdata[\s-]*scientist\b|дата[\s-]*саентист|специалист\p{L}*\s+по\s+data science/iu },
  { category: 'RESEARCH', name: 'Research Engineer/Scientist', regex: /\bresearch[\s-]*(?:engineer|scientist)\b|\bapplied[\s-]*scientist\b/i },
  { category: 'SECURITY', name: 'Security/AppSec Engineer', regex: /(?:^|[^\p{L}\p{N}_])(?:application security|appsec|security)[\s-]*(?:engineer|analyst|developer|инженер|аналитик|разработчик)(?:$|[^\p{L}\p{N}_])/iu },
  { category: 'SECURITY', name: 'ИБ/AppSec специалист', regex: /(?:appsec|информационн\p{L}*\s+безопасност|иб)[\s-]*(?:инженер|аналитик|специалист)?/iu },
  { category: 'PLATFORM', name: 'Platform Engineer', regex: /\bplatform[\s-]*engineer\b/i },
  { category: 'DATA_ENGINEERING', name: 'Data Engineer', regex: /\bdata[\s-]*engineer\b/i },
];

/**
 * Off-target groups are intentionally split by severity.
 * Absolute: role itself is outside the user's target.
 * Soft: may contain AI work but usually not AI engineering.
 * Stack: technical role, but usually wrong specialization.
 */
const offTargetRolePatterns = [
  // Absolute functional mismatch
  { severity: 'absolute', category: 'HR', name: 'HR/Recruiter', regex: /\brecruiter\b|(?:^|[^a-z])hr(?:$|[^a-z])|рекрутер|эйчар|подбор\s+персонал/iu },
  { severity: 'absolute', category: 'SALES', name: 'Sales', regex: /\bsales\b|продаж/iu },
  { severity: 'absolute', category: 'MARKETING', name: 'Marketing', regex: /\bmarketing\b|маркетолог|маркетинг/iu },
  { severity: 'absolute', category: 'CUSTOMER_SUCCESS', name: 'Customer Success/Account Manager', regex: /\bcustomer[\s-]*success\b|\baccount[\s-]*manager\b|аккаунт[\s-]*менеджер/iu },
  { severity: 'absolute', category: 'SUPPORT', name: 'Support', regex: /\bsupport[\s-]*(?:engineer|specialist|manager)\b|техподдержк|поддержк\p{L}*\s+пользовател/iu },
  { severity: 'absolute', category: 'PRODUCT_MANAGEMENT', name: 'Product Manager', regex: /\bproduct[\s-]*manager\b|продакт[\s-]*менеджер|менеджер\s+продукт/iu },
  { severity: 'absolute', category: 'PROJECT_MANAGEMENT', name: 'Project Manager', regex: /\bproject[\s-]*manager\b|проектн\p{L}*\s+менеджер|менеджер\s+проект/iu },
  { severity: 'absolute', category: 'PROGRAM_MANAGEMENT', name: 'Program/Delivery Manager', regex: /\b(?:program|delivery)[\s-]*manager\b/iu },
  { severity: 'absolute', category: 'ENGINEERING_MANAGEMENT', name: 'Engineering Manager', regex: /\bengineering[\s-]*manager\b|руководител\p{L}*\s+разработ/iu },
  { severity: 'absolute', category: 'DESIGN', name: 'Designer', regex: /\bdesigner\b|дизайнер/iu },
  { severity: 'absolute', category: 'ONE_C', name: '1C Developer', regex: /(?:^|[^\p{L}\p{N}_])1[сc](?:$|[^\p{L}\p{N}_])/iu },

  // Soft mismatch
  { severity: 'soft', category: 'BUSINESS_ANALYSIS', name: 'Business Analyst', regex: /\bbusiness[\s-]*analyst\b|бизнес[\s-]*аналитик/iu },
  { severity: 'soft', category: 'SYSTEM_ANALYSIS', name: 'System Analyst', regex: /\bsystem[\s-]*analyst\b|системн\p{L}*\s+аналитик/iu },
  { severity: 'soft', category: 'DATA_ANALYSIS', name: 'Data Analyst', regex: /\bdata[\s-]*analyst\b|аналитик\s+данн/iu },
  { severity: 'soft', category: 'BI_ANALYSIS', name: 'BI Analyst', regex: /\bbi[\s-]*analyst\b|bi[\s-]*аналитик/iu },
  { severity: 'soft', category: 'PRODUCT_ANALYSIS', name: 'Product Analyst', regex: /\bproduct[\s-]*analyst\b|продуктов\p{L}*\s+аналитик/iu },
  { severity: 'soft', category: 'CONSULTING', name: 'Consultant', regex: /\bconsultant\b|консультант/iu },
  { severity: 'soft', category: 'DEVOPS', name: 'DevOps/SRE', regex: /\bdev[\s-]*ops\b|\bsre\b|site reliability/iu },

  // Stack mismatch
  { severity: 'stack', category: 'FRONTEND', name: 'Frontend Developer', regex: /\bfront[\s-]*end\b|фронтенд|фронтэнд/iu },
  { severity: 'stack', category: 'MOBILE', name: 'Mobile Developer', regex: /\bandroid\b|\bios\b|mobile[\s-]*(?:developer|engineer)|мобильн\p{L}*\s+разработчик/iu },
  { severity: 'stack', category: 'QA', name: 'QA/Test', regex: /(?:^|[^a-z])qa(?:$|[^a-z])|quality assurance|тестировщик|инженер\s+по\s+тестированию/iu },
  { severity: 'stack', category: 'PHP', name: 'PHP Developer', regex: /\bphp\b/iu },
  { severity: 'stack', category: 'JAVA', name: 'Java Developer', regex: /\bjava\b/iu },
  { severity: 'stack', category: 'DOTNET', name: '.NET/C# Developer', regex: /\.net\b|\bc#\b|\bcsharp\b/iu },
  { severity: 'stack', category: 'CPP', name: 'C++ Developer', regex: /\bc\+\+\b/iu },
];

// ============================================================
// 4. AI DOMAIN / IMPLEMENTATION TAXONOMY
// ============================================================

const AI_TIER_A = new Set([
  'LLM',
  'GENAI',
  'AI_AGENTS',
  'AI_ASSISTANTS',
  'RAG',
  'PROMPT_ENGINEERING',
  'LLMOPS',
  'EMBEDDINGS',
  'VECTOR_SEARCH',
]);

const AI_TIER_B = new Set([
  'NLP',
  'INFERENCE',
  'FOUNDATION_MODELS',
  'MULTIMODAL',
  'TRANSFORMERS',
  'FINE_TUNING',
  'CONVERSATIONAL_AI',
]);

const AI_TIER_C = new Set([
  'MACHINE_LEARNING',
  'DEEP_LEARNING',
  'NEURAL_NETWORKS',
  'MLOPS',
  'AIOPS',
  'MLSECOPS',
  'SPEECH_AI',
  'COMPUTER_VISION',
]);

const aiPatterns = [
  // General AI
  { category: 'GENERAL_AI', strength: 'medium', name: 'AI / Artificial Intelligence', regex: /\bartificial intelligence\b|искусственн\p{L}*\s+интеллект|(?:^|[^\p{L}\p{N}_])ии(?:$|[^\p{L}\p{N}_])/iu },
  { category: 'GENERAL_AI', strength: 'medium', name: 'AI term', regex: /(?:^|[^a-z0-9_])ai(?:$|[^a-z0-9_])/i },
  { category: 'GENERAL_AI', strength: 'high', name: 'AI Engineering/Development', regex: /\bai[\s-]*(?:engineering|development|solutions?|platform)\b/i },

  // LLM / GenAI
  { category: 'LLM', strength: 'high', name: 'LLM', regex: /\bllms?\b|\blarge language models?\b|больш\p{L}*\s+языков\p{L}*\s+модел|языков\p{L}*\s+модел/iu },
  { category: 'GENAI', strength: 'high', name: 'GenAI / Generative AI', regex: /\bgen[\s-]*ai\b|\bgenerative[\s-]*(?:ai|artificial intelligence)\b|генеративн\p{L}*\s+(?:ии|искусственн\p{L}*\s+интеллект|модел)/iu },

  // Agents / assistants
  { category: 'AI_AGENTS', strength: 'high', name: 'AI Agents', regex: /\bai[\s-]*agents?\b|(?:^|[^\p{L}\p{N}_])(?:ai|ии)[\s-]*агент\p{L}*|агентн\p{L}*\s+систем|агентск\p{L}*\s+систем/iu },
  { category: 'AI_AGENTS', strength: 'high', name: 'Agentic / Multi-agent', regex: /\bagentic[\s-]*ai\b|\bautonomous[\s-]*agents?\b|\bmulti[\s-]*agents?\b|мульти[\s-]*агент/iu },
  { category: 'AI_ASSISTANTS', strength: 'high', name: 'AI Assistant/Copilot', regex: /\bai[\s-]*(?:assistant|copilot)\b|(?:^|[^\p{L}\p{N}_])ии[\s-]*(?:ассистент|помощник)/iu },
  { category: 'CONVERSATIONAL_AI', strength: 'high', name: 'Conversational AI', regex: /\bconversational[\s-]*ai\b|разговорн\p{L}*\s+(?:ии|ai)|диалогов\p{L}*\s+систем/iu },

  // RAG / NLP
  { category: 'RAG', strength: 'high', name: 'RAG', regex: /(?:^|[^a-z0-9_])rag(?:$|[^a-z0-9_])|\bretrieval[\s-]*augmented[\s-]*generation\b/i },
  { category: 'NLP', strength: 'high', name: 'NLP', regex: /(?:^|[^a-z0-9_])nlp(?:$|[^a-z0-9_])|\bnatural language processing\b|обработк\p{L}*\s+естественн\p{L}*\s+язык/iu },

  // ML / DL
  { category: 'MACHINE_LEARNING', strength: 'medium', name: 'Machine Learning', regex: /\bmachine learning\b|машинн\p{L}*\s+обучен/iu },
  { category: 'DEEP_LEARNING', strength: 'medium', name: 'Deep Learning', regex: /\bdeep learning\b|глубок\p{L}*\s+обучен/iu },
  { category: 'NEURAL_NETWORKS', strength: 'medium', name: 'Neural Networks', regex: /\bneural networks?\b|нейросет|нейронн\p{L}*\s+сет/iu },

  // Prompt engineering
  { category: 'PROMPT_ENGINEERING', strength: 'high', name: 'Prompt Engineering', regex: /\bprompt[\s-]*(?:engineering|engineer)\b|промпт[\s-]*(?:инженер|инжиниринг)/iu },

  // Ops / security
  { category: 'LLMOPS', strength: 'high', name: 'LLMOps', regex: /\bllm[\s-]*ops\b/i },
  { category: 'AIOPS', strength: 'medium', name: 'AIOps', regex: /\bai[\s-]*ops\b/i },
  { category: 'MLOPS', strength: 'medium', name: 'MLOps', regex: /\bml[\s-]*ops\b/i },
  { category: 'MLSECOPS', strength: 'medium', name: 'MLSecOps', regex: /\bml[\s-]*sec[\s-]*ops\b/i },

  // Model runtime
  { category: 'INFERENCE', strength: 'high', name: 'Model Inference/Serving', regex: /\b(?:llm|model)[\s-]*(?:inference|serving)\b|\binference[\s-]*(?:engineer|pipeline|runtime)\b/i },
  { category: 'FOUNDATION_MODELS', strength: 'medium', name: 'Foundation Models', regex: /\bfoundation models?\b/i },
  { category: 'MULTIMODAL', strength: 'medium', name: 'Multimodal', regex: /\bmultimodal\b|мультимодальн/iu },

  // Retrieval / embeddings
  { category: 'EMBEDDINGS', strength: 'high', name: 'Embeddings', regex: /\bembeddings?\b|эмбеддинг|векторн\p{L}*\s+представлен/iu },
  { category: 'VECTOR_SEARCH', strength: 'high', name: 'Vector Search/DB', regex: /\bvector search\b|\bvector (?:database|db)\b|векторн\p{L}*\s+поиск/iu },

  // Transformers / fine-tuning
  { category: 'TRANSFORMERS', strength: 'medium', name: 'Transformers', regex: /\btransformers?\b/i },
  { category: 'FINE_TUNING', strength: 'high', name: 'Fine-tuning', regex: /\bfine[\s-]*tun(?:e|ing)\b|\bfinetuning\b|\bqlora\b|\blora\b|\bpeft\b|дообучен\p{L}*\s+модел/iu },

  // Speech / CV
  { category: 'SPEECH_AI', strength: 'high', name: 'Speech AI', regex: /\bspeech recognition\b|(?:^|[^a-z0-9_])asr(?:$|[^a-z0-9_])|(?:^|[^a-z0-9_])stt(?:$|[^a-z0-9_])|(?:^|[^a-z0-9_])tts(?:$|[^a-z0-9_])|\btext[\s-]*to[\s-]*speech\b|\bspeech[\s-]*to[\s-]*text\b/i },
  { category: 'COMPUTER_VISION', strength: 'high', name: 'Computer Vision', regex: /\bcomputer vision\b|компьютерн\p{L}*\s+зрен/iu },
];

const aiImplementationPatterns = [
  // Agent frameworks
  { category: 'AGENT_FRAMEWORKS', tier: 'A', name: 'LangChain', regex: /\blang[\s-]*chain\b/i },
  { category: 'AGENT_FRAMEWORKS', tier: 'A', name: 'LangGraph', regex: /\blang[\s-]*graph\b/i },
  { category: 'AGENT_FRAMEWORKS', tier: 'A', name: 'LlamaIndex', regex: /\bllama[\s-]*index\b/i },
  { category: 'AGENT_FRAMEWORKS', tier: 'A', name: 'CrewAI', regex: /\bcrew[\s-]*ai\b/i },
  { category: 'AGENT_FRAMEWORKS', tier: 'A', name: 'AutoGen', regex: /\bauto[\s-]*gen\b/i },
  { category: 'AGENT_FRAMEWORKS', tier: 'A', name: 'Semantic Kernel', regex: /\bsemantic[\s-]*kernel\b/i },
  { category: 'AGENT_FRAMEWORKS', tier: 'A', name: 'Dify', regex: /\bdify\b/i },
  { category: 'AGENT_FRAMEWORKS', tier: 'A', name: 'PydanticAI', regex: /\bpydantic[\s-]*ai\b/i },
  { category: 'AGENT_FRAMEWORKS', tier: 'A', name: 'DSPy', regex: /\bdspy\b/i },
  { category: 'AGENT_FRAMEWORKS', tier: 'A', name: 'Haystack', regex: /\bhaystack\b/i },
  { category: 'AGENT_FRAMEWORKS', tier: 'A', name: 'OpenAI Agents SDK', regex: /\bopenai[\s-]*agents?[\s-]*(?:sdk|framework)\b/i },

  // Agent protocols
  { category: 'AGENT_PROTOCOLS', tier: 'A', name: 'Model Context Protocol', regex: /\bmodel context protocol\b/i },
  { category: 'AGENT_PROTOCOLS', tier: 'A', name: 'MCP', regex: /(?:^|[^a-z0-9_])mcp(?:$|[^a-z0-9_])/i },
  { category: 'AGENT_PROTOCOLS', tier: 'A', name: 'FastMCP', regex: /\bfast[\s-]*mcp\b/i },
  { category: 'AGENT_PROTOCOLS', tier: 'A', name: 'A2A', regex: /(?:^|[^a-z0-9_])a2a(?:$|[^a-z0-9_])/i },
  { category: 'AGENT_PROTOCOLS', tier: 'A', name: 'AG-UI', regex: /\bag[\s-]*ui\b/i },

  // Vector DBs
  { category: 'VECTOR_DATABASES', tier: 'A', name: 'FAISS', regex: /\bfaiss\b/i },
  { category: 'VECTOR_DATABASES', tier: 'A', name: 'Chroma', regex: /\bchroma(?:db)?\b/i },
  { category: 'VECTOR_DATABASES', tier: 'A', name: 'Pinecone', regex: /\bpinecone\b/i },
  { category: 'VECTOR_DATABASES', tier: 'A', name: 'Weaviate', regex: /\bweaviate\b/i },
  { category: 'VECTOR_DATABASES', tier: 'A', name: 'Qdrant', regex: /\bqdrant\b/i },
  { category: 'VECTOR_DATABASES', tier: 'A', name: 'Milvus', regex: /\bmilvus\b/i },
  { category: 'VECTOR_DATABASES', tier: 'A', name: 'pgvector', regex: /\bpgvector\b/i },

  { category: 'RAG_STACK', tier: 'A', name: 'Reranker/Reranking', regex: /\brerank(?:er|ing)?\b/i },
  { category: 'RAG_STACK', tier: 'B', name: 'Hybrid Search/BM25', regex: /\bhybrid search\b|\bbm25\b/i },
  { category: 'AI_OBSERVABILITY', tier: 'B', name: 'LangSmith', regex: /\blang[\s-]*smith\b/i },
  { category: 'AI_OBSERVABILITY', tier: 'B', name: 'Langfuse', regex: /\blangfuse\b/i },

  // Providers / ecosystems
  { category: 'MODEL_PROVIDERS', tier: 'A', name: 'OpenAI API', regex: /\bopenai[\s-]*api\b/i },
  { category: 'MODEL_PROVIDERS', tier: 'A', name: 'NVIDIA API/NIM', regex: /\bnvidia[\s-]*(?:api|nim)\b/i },
  { category: 'MODEL_PROVIDERS', tier: 'A', name: 'Anthropic/Claude API', regex: /\b(?:anthropic|claude)[\s-]*api\b/i },
  { category: 'MODEL_PROVIDERS', tier: 'A', name: 'Gemini API', regex: /\bgemini[\s-]*api\b/i },
  { category: 'MODEL_ECOSYSTEM', tier: 'B', name: 'Hugging Face', regex: /\bhugging[\s-]*face\b/i },
  { category: 'MODEL_ECOSYSTEM', tier: 'B', name: 'OpenAI', regex: /\bopenai\b/i },
  { category: 'MODEL_ECOSYSTEM', tier: 'B', name: 'Claude', regex: /\bclaude\b/i },
  { category: 'MODEL_ECOSYSTEM', tier: 'B', name: 'Anthropic', regex: /\banthropic\b/i },
  { category: 'MODEL_ECOSYSTEM', tier: 'B', name: 'Gemini', regex: /\bgemini\b/i },
  { category: 'MODEL_ECOSYSTEM', tier: 'B', name: 'Llama', regex: /\bllama\b/i },
  { category: 'MODEL_ECOSYSTEM', tier: 'B', name: 'Mistral', regex: /\bmistral\b/i },
  { category: 'MODEL_ECOSYSTEM', tier: 'B', name: 'Qwen', regex: /\bqwen\b/i },
  { category: 'MODEL_ECOSYSTEM', tier: 'B', name: 'GPT', regex: /\bgpt(?:[\s-]?\d[\w.-]*)?\b/i },

  // Inference stack
  { category: 'INFERENCE_STACK', tier: 'B', name: 'vLLM', regex: /\bvllm\b/i },
  { category: 'INFERENCE_STACK', tier: 'B', name: 'Ollama', regex: /\bollama\b/i },
  { category: 'INFERENCE_STACK', tier: 'B', name: 'TensorRT', regex: /\btensorrt\b/i },
  { category: 'INFERENCE_STACK', tier: 'B', name: 'ONNX', regex: /\bonnx\b/i },

  // Runtime patterns
  { category: 'AI_RUNTIME', tier: 'A', name: 'Tool Calling', regex: /\btool[\s-]*(?:calling|use)\b/i },
  { category: 'AI_RUNTIME', tier: 'A', name: 'Function Calling', regex: /\bfunction[\s-]*calling\b/i },
  { category: 'AI_RUNTIME', tier: 'A', name: 'Structured Output', regex: /\bstructured[\s-]*outputs?\b/i },
  { category: 'AI_RUNTIME', tier: 'A', name: 'LLM Evaluation', regex: /\bllm[\s-]*(?:evaluation|evals?)\b/i },
];

/**
 * Generic engineering signals can support AI evidence.
 * They can NEVER pass a vacancy on their own.
 */
const genericTechPatterns = [
  { category: 'PYTHON', name: 'Python', regex: /\bpython\b/i },
  { category: 'PYTORCH', name: 'PyTorch', regex: /\bpytorch\b/i },
  { category: 'TENSORFLOW', name: 'TensorFlow', regex: /\btensorflow\b/i },
  { category: 'KERAS', name: 'Keras', regex: /\bkeras\b/i },
  { category: 'FASTAPI', name: 'FastAPI', regex: /\bfast[\s-]*api\b/i },
  { category: 'REST', name: 'REST API', regex: /\brest[\s-]*api\b/i },
  { category: 'ASYNCIO', name: 'AsyncIO', regex: /\basyncio\b/i },
  { category: 'DOCKER', name: 'Docker', regex: /\bdocker\b/i },
  { category: 'KUBERNETES', name: 'Kubernetes', regex: /\bkubernetes\b/i },
  { category: 'API_INTEGRATION', name: 'API Integration', regex: /\bapi[\s-]*integration\b|интеграц\p{L}*\s+api/iu },
  { category: 'AUTOMATION', name: 'Automation', regex: /\bautomation\b|автоматизац/iu },
  { category: 'OBSERVABILITY', name: 'Observability', regex: /\bobservability\b/i },
  { category: 'TRACING', name: 'Tracing', regex: /\btracing\b/i },
  { category: 'SEMANTIC_SEARCH', name: 'Semantic Search', regex: /\bsemantic search\b|\bsimilarity search\b/i },
  { category: 'PROMPT_WEAK', name: 'Prompt', regex: /\bprompts?\b|промпт/iu },
  { category: 'CONTEXT_WEAK', name: 'Context', regex: /\bcontext\b|контекст/iu },
  { category: 'MEMORY_WEAK', name: 'Memory', regex: /\bmemory\b|памят/iu },
  { category: 'EVALUATION_WEAK', name: 'Evaluation/Evals', regex: /\bevaluation\b|\bevals?\b|оценк\p{L}*\s+модел/iu },
];

// ============================================================
// 5. CORE AI WORK VS INCIDENTAL AI MENTION
// ============================================================

const aiObject = String.raw`(?:llm|llms|large language model|gen[\s-]*ai|generative ai|ai[\s-]*agents?|ии[\s-]*агент\p{L}*|rag|retrieval[\s-]*augmented[\s-]*generation|нейросет\p{L}*|machine learning|машинн\p{L}*\s+обучен\p{L}*|nlp|natural language processing|ai[\s-]*assistant|ии[\s-]*ассистент|foundation model|мультимодальн\p{L}*\s+модел\p{L}*)`;

const buildVerbRu = String.raw`(?:разрабат\p{L}*|создава\p{L}*|строи\p{L}*|проектир\p{L}*|реализ\p{L}*|внедр\p{L}*|интегрир\p{L}*|оркестрир\p{L}*|дообуч\p{L}*|обуча\p{L}*|депло\p{L}*|разворач\p{L}*|оптимизир\p{L}*|оценив\p{L}*|тестир\p{L}*|поддержива\p{L}*)`;
const buildVerbEn = String.raw`(?:build(?:ing)?|develop(?:ing)?|design(?:ing)?|implement(?:ing)?|integrat(?:e|ing)|orchestrat(?:e|ing)|deploy(?:ing)?|fine[\s-]*tun(?:e|ing)|train(?:ing)?|serv(?:e|ing)|optimi[sz](?:e|ing)|evaluat(?:e|ing)|test(?:ing)?|maintain(?:ing)?)`;

const coreAiWorkPatterns = [
  {
    category: 'BUILD_AI_SYSTEMS',
    name: 'Build/develop AI systems',
    regex: new RegExp(`${buildVerbRu}[^.!?\\n]{0,140}${aiObject}|${aiObject}[^.!?\\n]{0,140}${buildVerbRu}`, 'iu'),
  },
  {
    category: 'BUILD_AI_SYSTEMS',
    name: 'Build/develop AI systems (EN)',
    regex: new RegExp(`${buildVerbEn}[^.!?\\n]{0,140}${aiObject}|${aiObject}[^.!?\\n]{0,140}${buildVerbEn}`, 'i'),
  },
  {
    category: 'RAG_PIPELINES',
    name: 'Build RAG/retrieval pipelines',
    regex: /(?:разрабат\p{L}*|создава\p{L}*|строи\p{L}*|проектир\p{L}*|внедр\p{L}*|build|develop|design|implement)[^.!?\n]{0,120}(?:rag|retrieval|векторн\p{L}*\s+поиск|semantic search|эмбеддинг)/iu,
  },
  {
    category: 'AGENT_SYSTEMS',
    name: 'Build agent systems/workflows',
    regex: /(?:разрабат\p{L}*|создава\p{L}*|строи\p{L}*|проектир\p{L}*|оркестрир\p{L}*|build|develop|design|orchestrat\w*)[^.!?\n]{0,120}(?:ai[\s-]*агент|ии[\s-]*агент|ai[\s-]*agent|agentic|multi[\s-]*agent|langgraph|crewai|autogen)/iu,
  },
  {
    category: 'MODEL_INTEGRATION',
    name: 'Integrate LLM/model APIs',
    regex: /(?:интегрир\p{L}*|подключ\p{L}*|работ\p{L}*\s+с\s+api|integrat\w*|api integration)[^.!?\n]{0,120}(?:llm|openai|anthropic|claude|gemini|mistral|qwen|nvidia|model api|ai api)/iu,
  },
  {
    category: 'PROMPT_CONTEXT_MEMORY',
    name: 'Engineer prompts/context/memory',
    regex: /(?:prompt engineering|промпт[\s-]*инжиниринг|управлен\p{L}*\s+контекст|context management|memory system|систем\p{L}*\s+памят|tool calling|function calling|structured outputs?)/iu,
  },
  {
    category: 'MODEL_TRAINING',
    name: 'Train/fine-tune models',
    regex: /(?:fine[\s-]*tun\w*|finetun\w*|дообуч\p{L}*|обуча\p{L}*\s+модел|lora|qlora|peft)/iu,
  },
  {
    category: 'MODEL_SERVING',
    name: 'Serve/deploy models',
    regex: /(?:model serving|llm serving|inference serving|разворач\p{L}*\s+модел|депло\p{L}*\s+модел|vllm|tensorrt)[^.!?\n]{0,100}/iu,
  },
  {
    category: 'AI_EVALUATION',
    name: 'Evaluate/test LLM systems',
    regex: /(?:llm evaluation|llm evals?|оценк\p{L}*\s+качества\s+(?:llm|ии|модел)|тестир\p{L}*\s+(?:llm|ai[\s-]*систем|ии[\s-]*систем))/iu,
  },
];

const incidentalAiPatterns = [
  {
    category: 'PLUS_ONLY',
    name: 'AI only as a plus',
    regex: /(?:будет\s+(?:плюсом|преимуществом)|желательно|nice to have|would be a plus)[^.!?\n]{0,140}(?:llm|(?<![a-z0-9_])ai(?![a-z0-9_])|(?<![\p{L}\p{N}_])ии(?![\p{L}\p{N}_])|нейросет|machine learning|rag|genai)/iu,
  },
  {
    category: 'BASIC_FAMILIARITY',
    name: 'Basic familiarity with AI',
    regex: /(?:базов\p{L}*\s+(?:знани|понимани|опыт)|знакомств\p{L}*\s+с|понимание\s+основ|basic\s+(?:knowledge|understanding|experience)|familiarity\s+with)[^.!?\n]{0,140}(?:llm|(?<![a-z0-9_])ai(?![a-z0-9_])|(?<![\p{L}\p{N}_])ии(?![\p{L}\p{N}_])|нейросет|machine learning|rag|genai)/iu,
  },
  {
    category: 'USER_LEVEL_AI',
    name: 'AI usage at user level',
    regex: /(?:использован\p{L}*|работа\s+с|опыт\s+работы\s+с|use|using)[^.!?\n]{0,80}(?:chatgpt|copilot|ai[\s-]*tools?|ии[\s-]*инструмент)[^.!?\n]{0,80}(?:в\s+работе|для\s+работы|productivity|на\s+уровне\s+пользовател)?/iu,
  },
  {
    category: 'AI_DOMAIN_COMPANY_ONLY',
    name: 'Company/domain mentions AI only',
    regex: /(?:компания|продукт|платформа|рынок|сфера)[^.!?\n]{0,100}(?:работает|занимается|в\s+сфере)[^.!?\n]{0,100}(?:(?<![\p{L}\p{N}_])ии(?![\p{L}\p{N}_])|(?<![a-z0-9_])ai(?![a-z0-9_])|искусственн\p{L}*\s+интеллект)/iu,
  },
];

// ============================================================
// 6. SENIORITY / EXPERIENCE
// ============================================================

const levelPatterns = [
  { category: 'INTERN', name: 'Intern/Trainee', regex: /\bintern(?:ship)?\b|\btrainee\b|стаж[её]р/iu },
  { category: 'JUNIOR', name: 'Junior', regex: /\bjunior\b|джун(?:иор)?/iu },
  { category: 'MIDDLE', name: 'Middle', regex: /\bmiddle\b|миддл|мидл/iu },
  { category: 'MIDDLE_PLUS', name: 'Middle+', regex: /\bmiddle\s*\+\b/i },
  { category: 'SENIOR', name: 'Senior', regex: /\bsenior\b|сеньор|старш\p{L}*/iu },
  { category: 'LEAD', name: 'Lead', regex: /\b(?:tech|team)?[\s-]*lead\b|ведущ\p{L}*/iu },
  { category: 'PRINCIPAL', name: 'Principal', regex: /\bprincipal\b/i },
  { category: 'STAFF', name: 'Staff', regex: /\bstaff\b/i },
  { category: 'HEAD', name: 'Head', regex: /\bhead\b|руководител/iu },
  { category: 'ARCHITECT', name: 'Architect', regex: /\barchitect\b|архитектор/iu },
];

const russianNumberWords = {
  'один': 1,
  'одного': 1,
  'одна': 1,
  'два': 2,
  'двух': 2,
  'две': 2,
  'три': 3,
  'трех': 3,
  'трёх': 3,
  'четыре': 4,
  'четырех': 4,
  'четырёх': 4,
  'пять': 5,
  'пяти': 5,
  'шесть': 6,
  'шести': 6,
  'семь': 7,
  'семи': 7,
  'восемь': 8,
  'восьми': 8,
  'девять': 9,
  'девяти': 9,
  'десять': 10,
  'десяти': 10,
};

function wordOrDigitToNumber(value) {
  const normalized = normalizeText(value);
  if (/^\d+$/u.test(normalized)) return Number(normalized);
  return russianNumberWords[normalized] ?? null;
}

function parseExperienceYears(text) {
  const normalized = normalizeText(text);
  const candidates = [];

  // 3-5 years / 3 to 5 years / 3–5 лет
  const rangeRegex = /(?<!\d)(\d{1,2})\s*(?:-|to|до)\s*(\d{1,2})(?!\d)\s*(?:лет|года|год|years?|yrs?)/giu;
  for (const match of normalized.matchAll(rangeRegex)) {
    candidates.push({ min: Number(match[1]), max: Number(match[2]), raw: match[0] });
  }

  // 5+ years / at least 5 years / от 5 лет / не менее 5 лет / минимум 5 лет
  const minRegex = /(?:не\s+менее|минимум|от|at\s+least|minimum|more\s+than|over)?\s*(\d{1,2})\s*\+?\s*(?:лет|года|год|years?|yrs?)(?:\s+(?:опыта|experience))?/giu;
  for (const match of normalized.matchAll(minRegex)) {
    candidates.push({ min: Number(match[1]), max: null, raw: match[0] });
  }

  // Russian words: "не менее пяти лет", "от трех лет"
  const words = Object.keys(russianNumberWords)
    .sort((a, b) => b.length - a.length)
    .join('|');
  const wordRegex = new RegExp(`(?:не\\s+менее|минимум|от)?\\s*(${words})\\s+(?:лет|года|год)(?:\\s+опыта)?`, 'giu');
  for (const match of normalized.matchAll(wordRegex)) {
    const value = wordOrDigitToNumber(match[1]);
    if (value !== null) candidates.push({ min: value, max: null, raw: match[0] });
  }

  if (candidates.length === 0) {
    return {
      min_years: null,
      max_years: null,
      matches: [],
    };
  }

  // We use the highest explicit minimum as the risk signal.
  const highest = [...candidates].sort((a, b) => b.min - a.min)[0];

  return {
    min_years: highest.min,
    max_years: highest.max,
    matches: uniq(candidates.map((candidate) => candidate.raw)),
  };
}

function classifySeniority(titleText, allText) {
  const levelMatches = matchPatterns(levelPatterns, titleText);
  const levelCategories = categories(levelMatches);
  const experience = parseExperienceYears(allText);

  let risk = 'low';

  if (
    levelCategories.some((category) =>
      ['LEAD', 'PRINCIPAL', 'STAFF', 'HEAD', 'ARCHITECT'].includes(category)
    ) ||
    (experience.min_years !== null && experience.min_years >= 5)
  ) {
    risk = 'high';
  } else if (
    levelCategories.includes('SENIOR') ||
    (experience.min_years !== null && experience.min_years >= 3)
  ) {
    risk = 'medium';
  }

  return {
    level_matches: names(levelMatches),
    level_categories: levelCategories,
    experience_min_years_hint: experience.min_years,
    experience_max_years_hint: experience.max_years,
    experience_matches: experience.matches,
    risk,
  };
}

// ============================================================
// 7. WORK FORMAT / LOCATION
// ============================================================

const remoteExplicitHighPatterns = [
  /можно\s+удаленн/iu,
  /полностью\s+удален/iu,
  /полностью\s+дистанцион/iu,
  /работа\s+из\s+любой\s+точки/iu,
  /работать\s+из\s+любой\s+точки/iu,
  /(?:^|[^a-z])full[\s-]*remote(?:$|[^a-z])/i,
  /(?:^|[^a-z])fully[\s-]*remote(?:$|[^a-z])/i,
  /\bwork[\s-]*from[\s-]*anywhere\b/i,
];

const remotePositivePatterns = [
  ...remoteExplicitHighPatterns,
  /удаленн\p{L}*\s+работ/iu,
  /дистанционн\p{L}*\s+работ/iu,
  /\bremote[\s-]*first\b/i,
  /\bwork[\s-]*from[\s-]*home\b/i,
  /(?:^|[^a-z])remote(?:$|[^a-z])/i,
];

const remoteDeniedPatterns = [
  /удаленн\p{L}*\s+работ\p{L}*\s+не\s+предусмотр/iu,
  /удаленк\p{L}*\s+не\s+предусмотр/iu,
  /без\s+возможност\p{L}*\s+удален/iu,
  /удаленн\p{L}*\s+формат\p{L}*\s+нет/iu,
  /только\s+офис/iu,
  /исключительно\s+в\s+офис/iu,
  /\bno[\s-]*remote\b/i,
  /\bremote[\s-]*not[\s-]*available\b/i,
  /\bon[\s-]*site[\s-]*only\b/i,
];

const hybridPatterns = [
  /гибрид/iu,
  /(?:^|[^a-z])hybrid(?:$|[^a-z])/i,
  /частично\s+удален/iu,
  /частично\s+дистанцион/iu,
  /несколько\s+дней\s+в\s+офис/iu,
  /\d+\s+дн\p{L}*\s+в\s+офис/iu,
  /офис\p{L}*\s+\d+\s+дн/iu,
];

const officePatterns = [
  /работа\s+в\s+офис/iu,
  /офисн\p{L}*\s+формат/iu,
  /только\s+офис/iu,
  /исключительно\s+в\s+офис/iu,
  /работа\s+из\s+офиса/iu,
  /\bon[\s-]*site\b/i,
  /\bonsite\b/i,
  /\boffice[\s-]*based\b/i,
];

const tbilisiPatterns = [
  /тбилиси/iu,
  /(?:^|[^a-z])tbilisi(?:$|[^a-z])/i,
  /თბილისი/u,
];

const georgiaCountryPatterns = [
  /грузи\p{L}*/iu,
  /საქართველო/u,
  /\btbilisi\s*,?\s*georgia\b/i,
  /\bgeorgia\s*,?\s*tbilisi\b/i,
  /\bgeorgia\s*,?\s*(?:country|europe|caucasus)\b/i,
];

function classifyWorkFormat(text) {
  const remoteExplicitHigh = hasAny(remoteExplicitHighPatterns, text);
  const remotePositive = hasAny(remotePositivePatterns, text);
  const remoteDenied = hasAny(remoteDeniedPatterns, text);
  const hybrid = hasAny(hybridPatterns, text);
  const office = hasAny(officePatterns, text);

  const conflict =
    (remotePositive && remoteDenied) ||
    (remotePositive && hybrid) ||
    (remotePositive && office && !remoteExplicitHigh);

  // Strong explicit full-remote signal wins, but conflict is preserved.
  if (remoteExplicitHigh && !remoteDenied) {
    return {
      hint: 'remote',
      confidence: conflict ? 'medium' : 'high',
      conflict,
      remote_signal: true,
      hybrid_signal: hybrid,
      office_signal: office,
      remote_denied_signal: false,
    };
  }

  // Explicit denial of remote takes precedence over weak "remote" mentions.
  if (remoteDenied) {
    if (hybrid) {
      return {
        hint: 'hybrid',
        confidence: 'medium',
        conflict,
        remote_signal: false,
        hybrid_signal: true,
        office_signal: office,
        remote_denied_signal: true,
      };
    }

    if (office) {
      return {
        hint: 'office',
        confidence: 'high',
        conflict,
        remote_signal: false,
        hybrid_signal: false,
        office_signal: true,
        remote_denied_signal: true,
      };
    }
  }

  if (hybrid) {
    return {
      hint: 'hybrid',
      confidence: conflict ? 'low' : 'medium',
      conflict,
      remote_signal: remotePositive && !remoteDenied,
      hybrid_signal: true,
      office_signal: office,
      remote_denied_signal: remoteDenied,
    };
  }

  if (remotePositive && !remoteDenied) {
    return {
      hint: 'remote',
      confidence: conflict ? 'medium' : 'medium',
      conflict,
      remote_signal: true,
      hybrid_signal: false,
      office_signal: office,
      remote_denied_signal: false,
    };
  }

  if (office) {
    return {
      hint: 'office',
      confidence: 'medium',
      conflict,
      remote_signal: false,
      hybrid_signal: false,
      office_signal: true,
      remote_denied_signal: remoteDenied,
    };
  }

  return {
    hint: 'unknown',
    confidence: 'low',
    conflict,
    remote_signal: false,
    hybrid_signal: false,
    office_signal: false,
    remote_denied_signal: remoteDenied,
  };
}

function classifyGeoPolicy(workFormat, text) {
  const isTbilisi = hasAny(tbilisiPatterns, text);
  const isGeorgia = hasAny(georgiaCountryPatterns, text) || isTbilisi;

  let policy = 'needs_full_page_check';

  if (workFormat.hint === 'remote' && !workFormat.remote_denied_signal) {
    policy = 'allowed_remote';
  } else if (
    isTbilisi &&
    (workFormat.hint === 'hybrid' || workFormat.hint === 'office')
  ) {
    policy = 'allowed_tbilisi';
  } else if (isTbilisi && workFormat.hint === 'unknown') {
    policy = 'possible_tbilisi_needs_format_check';
  } else if (
    isGeorgia &&
    !isTbilisi &&
    (workFormat.hint === 'hybrid' || workFormat.hint === 'office')
  ) {
    policy = 'likely_reject_non_tbilisi_georgia';
  } else if (
    !isTbilisi &&
    (workFormat.hint === 'hybrid' || workFormat.hint === 'office')
  ) {
    policy = 'needs_full_page_location_check';
  }

  return {
    tbilisi_signal: isTbilisi,
    georgia_signal: isGeorgia,
    policy,
    needs_full_page_geo_check: !['allowed_remote', 'allowed_tbilisi'].includes(policy),
  };
}

// ============================================================
// 8. EVIDENCE COLLECTION
// ============================================================

function collectAiEvidence(parsed) {
  const titleText = parsed.vacancy_title_normalized;
  const skillsText = parsed.rss_skills_text;
  const narrativeText = parsed.rss_narrative_text;
  const fullText = parsed.rss_full_text;

  const aiTitleMatches = matchPatterns(aiPatterns, titleText);
  const aiSkillMatches = matchPatterns(aiPatterns, skillsText);
  const aiNarrativeMatches = matchPatterns(aiPatterns, narrativeText);

  const implTitleMatches = matchPatterns(aiImplementationPatterns, titleText);
  const implSkillMatches = matchPatterns(aiImplementationPatterns, skillsText);
  const implNarrativeMatches = matchPatterns(aiImplementationPatterns, narrativeText);

  const genericTitleMatches = matchPatterns(genericTechPatterns, titleText);
  const genericSkillMatches = matchPatterns(genericTechPatterns, skillsText);
  const genericNarrativeMatches = matchPatterns(genericTechPatterns, narrativeText);

  // Analyze task/requirement semantics on the narrative part, not on duplicated title/skills.
  // This prevents false incidental-AI matches caused by Habr boilerplate.
  const semanticTaskText = narrativeText || fullText;
  const coreWorkMatches = matchPatterns(coreAiWorkPatterns, semanticTaskText);
  const incidentalMatches = matchPatterns(incidentalAiPatterns, semanticTaskText);

  const allAiMatches = uniqueBy(
    [...aiTitleMatches, ...aiSkillMatches, ...aiNarrativeMatches],
    (match) => `${match.category}:${match.name}`
  );

  const allImplMatches = uniqueBy(
    [...implTitleMatches, ...implSkillMatches, ...implNarrativeMatches],
    (match) => `${match.category}:${match.name}`
  );

  const allGenericMatches = uniqueBy(
    [...genericTitleMatches, ...genericSkillMatches, ...genericNarrativeMatches],
    (match) => `${match.category}:${match.name}`
  );

  const allAiCategories = categories(allAiMatches);
  const substantiveAiCategories = allAiCategories.filter(
    (category) => category !== 'GENERAL_AI'
  );

  const tierACount = countIntersection(substantiveAiCategories, AI_TIER_A);
  const tierBCount = countIntersection(substantiveAiCategories, AI_TIER_B);
  const tierCCount = countIntersection(substantiveAiCategories, AI_TIER_C);

  const titleAiCategories = categories(aiTitleMatches);
  const skillAiCategories = categories(aiSkillMatches);
  const narrativeAiCategories = categories(aiNarrativeMatches);
  const implCategories = categories(allImplMatches);
  const genericCategories = categories(allGenericMatches);

  const incidentalOnly =
    incidentalMatches.length > 0 &&
    coreWorkMatches.length === 0 &&
    substantiveAiCategories.length <= 1 &&
    implCategories.length === 0;

  return {
    aiTitleMatches,
    aiSkillMatches,
    aiNarrativeMatches,
    allAiMatches,
    allAiCategories,
    substantiveAiCategories,
    titleAiCategories,
    skillAiCategories,
    narrativeAiCategories,

    implTitleMatches,
    implSkillMatches,
    implNarrativeMatches,
    allImplMatches,
    implCategories,

    allGenericMatches,
    genericCategories,

    coreWorkMatches,
    coreWorkCategories: categories(coreWorkMatches),
    incidentalMatches,
    incidentalCategories: categories(incidentalMatches),
    incidentalOnly,

    tierACount,
    tierBCount,
    tierCCount,
  };
}

function classifyRole(titleText) {
  const targetMatches = matchPatterns(targetRolePatterns, titleText);
  const adjacentMatches = matchPatterns(adjacentRolePatterns, titleText);
  const offTargetMatches = matchPatterns(offTargetRolePatterns, titleText);

  const targetTier = bestTier(targetMatches.map((match) => match.tier));
  const absoluteOffTarget = offTargetMatches.filter(
    (match) => match.severity === 'absolute'
  );
  const softOffTarget = offTargetMatches.filter(
    (match) => match.severity === 'soft'
  );
  const stackOffTarget = offTargetMatches.filter(
    (match) => match.severity === 'stack'
  );

  let roleClass = 'neutral';

  if (targetMatches.length > 0 && offTargetMatches.length > 0) {
    roleClass = 'mixed_target_off_target';
  } else if (targetMatches.length > 0) {
    roleClass = 'target';
  } else if (absoluteOffTarget.length > 0) {
    roleClass = 'absolute_off_target';
  } else if (softOffTarget.length > 0) {
    roleClass = 'soft_off_target';
  } else if (stackOffTarget.length > 0) {
    roleClass = 'stack_off_target';
  } else if (adjacentMatches.length > 0) {
    roleClass = 'adjacent';
  }

  return {
    roleClass,
    targetTier,
    targetMatches,
    adjacentMatches,
    offTargetMatches,
    absoluteOffTarget,
    softOffTarget,
    stackOffTarget,
  };
}

// ============================================================
// 9. PASS / REVIEW / REJECT DECISION ENGINE
// ============================================================

function decideVacancy(role, evidence) {
  const reasons = [];
  const warnings = [];
  const rejectionReasons = [];

  const substantiveCount = evidence.substantiveAiCategories.length;
  const implCount = evidence.implCategories.length;
  const coreWorkCount = evidence.coreWorkCategories.length;
  const titleSubstantiveCount = evidence.titleAiCategories.filter(
    (category) => category !== 'GENERAL_AI'
  ).length;
  const skillSubstantiveCount = evidence.skillAiCategories.filter(
    (category) => category !== 'GENERAL_AI'
  ).length;

  const topPriorityCount = evidence.tierACount + evidence.tierBCount;
  const denseAiEvidence =
    topPriorityCount >= 2 ||
    (topPriorityCount >= 1 && implCount >= 1) ||
    (substantiveCount >= 2 && implCount >= 1) ||
    implCount >= 2 ||
    coreWorkCount >= 1;

  // ----------------------------------------------------------
  // Hard rejects with high confidence
  // ----------------------------------------------------------

  if (
    role.roleClass === 'absolute_off_target' &&
    role.targetMatches.length === 0
  ) {
    rejectionReasons.push('absolute_off_target_role');
    return {
      decision: 'REJECT',
      code: 'reject_absolute_off_target_role',
      reasons,
      warnings,
      rejectionReasons,
    };
  }

  if (
    substantiveCount === 0 &&
    implCount === 0 &&
    coreWorkCount === 0
  ) {
    rejectionReasons.push('no_substantive_ai_evidence');
    return {
      decision: 'REJECT',
      code: 'reject_no_ai_evidence',
      reasons,
      warnings,
      rejectionReasons,
    };
  }

  if (
    evidence.incidentalOnly &&
    role.targetMatches.length === 0
  ) {
    rejectionReasons.push('ai_mentioned_only_incidentally');
    return {
      decision: 'REJECT',
      code: 'reject_incidental_ai_only',
      reasons,
      warnings,
      rejectionReasons,
    };
  }

  // ----------------------------------------------------------
  // Exact target roles
  // ----------------------------------------------------------

  if (role.targetMatches.length > 0) {
    reasons.push(`target_role_tier_${role.targetTier ?? 'unknown'}`);

    if (role.absoluteOffTarget.length > 0) {
      warnings.push('target_role_conflicts_with_absolute_off_target_role');
      return {
        decision: 'REVIEW',
        code: 'review_target_role_conflict',
        reasons,
        warnings,
        rejectionReasons,
      };
    }

    if (role.targetTier === 'A' || role.targetTier === 'B') {
      return {
        decision: 'PASS',
        code: 'pass_target_role',
        reasons,
        warnings,
        rejectionReasons,
      };
    }

    // Tier C is relevant, but less aligned with the user's primary profile.
    warnings.push('lower_profile_alignment_target_role');
    return {
      decision: 'REVIEW',
      code: 'review_tier_c_target_role',
      reasons,
      warnings,
      rejectionReasons,
    };
  }

  // ----------------------------------------------------------
  // Adjacent technical roles
  // ----------------------------------------------------------

  if (role.roleClass === 'adjacent') {
    if (
      coreWorkCount >= 1 &&
      substantiveCount >= 1
    ) {
      reasons.push('adjacent_role_with_explicit_core_ai_work');
      return {
        decision: 'PASS',
        code: 'pass_adjacent_with_core_ai_work',
        reasons,
        warnings,
        rejectionReasons,
      };
    }

    if (
      evidence.tierACount >= 2 ||
      (evidence.tierACount >= 1 && implCount >= 1) ||
      (topPriorityCount >= 2 && implCount >= 1)
    ) {
      reasons.push('adjacent_role_with_dense_high_priority_ai');
      return {
        decision: 'PASS',
        code: 'pass_adjacent_dense_ai',
        reasons,
        warnings,
        rejectionReasons,
      };
    }

    if (
      substantiveCount >= 1 &&
      (implCount >= 1 || skillSubstantiveCount >= 1 || titleSubstantiveCount >= 1)
    ) {
      warnings.push('adjacent_role_requires_full_page_validation');
      return {
        decision: 'REVIEW',
        code: 'review_adjacent_with_ai_evidence',
        reasons,
        warnings,
        rejectionReasons,
      };
    }

    rejectionReasons.push('adjacent_role_without_enough_ai_evidence');
    return {
      decision: 'REJECT',
      code: 'reject_adjacent_low_ai_evidence',
      reasons,
      warnings,
      rejectionReasons,
    };
  }

  // ----------------------------------------------------------
  // Soft off-target roles: analyst / consultant / DevOps
  // ----------------------------------------------------------

  if (role.roleClass === 'soft_off_target') {
    if (
      coreWorkCount >= 1 &&
      topPriorityCount >= 1 &&
      implCount >= 1
    ) {
      warnings.push('soft_off_target_role_but_core_ai_work_detected');
      return {
        decision: 'REVIEW',
        code: 'review_soft_off_target_with_core_ai',
        reasons,
        warnings,
        rejectionReasons,
      };
    }

    if (
      evidence.tierACount >= 2 &&
      implCount >= 2
    ) {
      warnings.push('soft_off_target_role_but_dense_ai_stack_detected');
      return {
        decision: 'REVIEW',
        code: 'review_soft_off_target_dense_ai',
        reasons,
        warnings,
        rejectionReasons,
      };
    }

    rejectionReasons.push('off_target_role_without_core_ai_work');
    return {
      decision: 'REJECT',
      code: 'reject_soft_off_target_low_ai_core',
      reasons,
      warnings,
      rejectionReasons,
    };
  }

  // ----------------------------------------------------------
  // Wrong technical stack roles: Frontend / QA / Mobile / etc.
  // ----------------------------------------------------------

  if (role.roleClass === 'stack_off_target') {
    if (
      coreWorkCount >= 1 &&
      evidence.tierACount >= 2 &&
      implCount >= 1
    ) {
      warnings.push('stack_off_target_role_but_strong_core_ai_work_detected');
      return {
        decision: 'REVIEW',
        code: 'review_stack_off_target_strong_ai',
        reasons,
        warnings,
        rejectionReasons,
      };
    }

    rejectionReasons.push('wrong_primary_technical_stack');
    return {
      decision: 'REJECT',
      code: 'reject_wrong_primary_stack',
      reasons,
      warnings,
      rejectionReasons,
    };
  }

  // ----------------------------------------------------------
  // Neutral / unconventional titles
  // ----------------------------------------------------------

  if (coreWorkCount >= 1 && topPriorityCount >= 1) {
    reasons.push('unconventional_title_with_explicit_core_ai_work');
    return {
      decision: 'PASS',
      code: 'pass_neutral_core_ai_work',
      reasons,
      warnings,
      rejectionReasons,
    };
  }

  if (
    evidence.tierACount >= 2 ||
    (topPriorityCount >= 2 && implCount >= 1) ||
    (substantiveCount >= 2 && implCount >= 2)
  ) {
    warnings.push('unconventional_title_with_dense_ai_evidence');
    return {
      decision: 'REVIEW',
      code: 'review_neutral_dense_ai',
      reasons,
      warnings,
      rejectionReasons,
    };
  }

  if (
    denseAiEvidence &&
    (titleSubstantiveCount >= 1 || skillSubstantiveCount >= 1)
  ) {
    warnings.push('ambiguous_role_but_ai_evidence_present');
    return {
      decision: 'REVIEW',
      code: 'review_ambiguous_ai_role',
      reasons,
      warnings,
      rejectionReasons,
    };
  }

  rejectionReasons.push('insufficient_ai_relevance');
  return {
    decision: 'REJECT',
    code: 'reject_insufficient_ai_relevance',
    reasons,
    warnings,
    rejectionReasons,
  };
}

// ============================================================
// 10. TRANSPARENT PRIORITY SCORE
// ============================================================

/**
 * Score is ONLY for ordering/prioritization.
 * PASS/REVIEW/REJECT is decided by explicit rules above.
 */
function calculatePriorityScore(role, evidence, seniority, workFormat, geo) {
  let score = 0;

  // Role alignment
  if (role.targetTier === 'A') score += 42;
  else if (role.targetTier === 'B') score += 34;
  else if (role.targetTier === 'C') score += 22;
  else if (role.roleClass === 'adjacent') score += 12;
  else if (role.roleClass === 'soft_off_target') score -= 10;
  else if (role.roleClass === 'stack_off_target') score -= 20;
  else if (role.roleClass === 'absolute_off_target') score -= 50;

  // AI domains, capped by category count
  score += Math.min(evidence.tierACount, 3) * 12;
  score += Math.min(evidence.tierBCount, 3) * 7;
  score += Math.min(evidence.tierCCount, 3) * 4;

  // Source quality of evidence
  const titleSubstantive = evidence.titleAiCategories.filter(
    (category) => category !== 'GENERAL_AI'
  ).length;
  const skillSubstantive = evidence.skillAiCategories.filter(
    (category) => category !== 'GENERAL_AI'
  ).length;

  score += Math.min(titleSubstantive, 2) * 7;
  score += Math.min(skillSubstantive, 3) * 5;
  score += Math.min(evidence.implCategories.length, 4) * 5;
  score += Math.min(evidence.coreWorkCategories.length, 2) * 12;

  // Generic tech only supports, never dominates
  score += Math.min(evidence.genericCategories.length, 4) * 1;

  // Incidental AI mention penalty
  score -= Math.min(evidence.incidentalCategories.length, 2) * 6;

  // Work-format preference
  if (workFormat.hint === 'remote' && !workFormat.remote_denied_signal) score += 5;
  if (geo.tbilisi_signal) score += 5;

  // Seniority lowers ordering priority, but does not reject here.
  if (seniority.risk === 'medium') score -= 4;
  if (seniority.risk === 'high') score -= 10;

  return clamp(Math.round(score), 0, 100);
}

function scoreToPriority(score) {
  if (score >= 80) return 'very_high';
  if (score >= 60) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

function scoreToConfidence(decision, role, evidence) {
  if (decision === 'REJECT') {
    if (
      role.roleClass === 'absolute_off_target' ||
      (evidence.substantiveAiCategories.length === 0 &&
        evidence.implCategories.length === 0)
    ) {
      return 'high';
    }
    return 'medium';
  }

  if (
    role.targetTier === 'A' ||
    evidence.coreWorkCategories.length >= 1 ||
    evidence.tierACount >= 2
  ) {
    return 'high';
  }

  return decision === 'PASS' ? 'medium' : 'low';
}

// ============================================================
// 11. MAIN LOOP
// ============================================================

const result = [];

for (let inputIndex = 0; inputIndex < items.length; inputIndex++) {
  const item = items[inputIndex];
  const parsed = parseHabrRss(item.json);

  const titleText = parsed.vacancy_title_normalized;
  const allText = [
    parsed.vacancy_title_normalized,
    parsed.rss_skills_text,
    parsed.rss_narrative_text,
    parsed.rss_full_text,
  ]
    .filter(Boolean)
    .join(' ');

  const role = classifyRole(titleText);
  const evidence = collectAiEvidence(parsed);
  const seniority = classifySeniority(titleText, allText);
  const workFormat = classifyWorkFormat(allText);
  const geo = classifyGeoPolicy(workFormat, allText);
  const decision = decideVacancy(role, evidence);

  const score = calculatePriorityScore(
    role,
    evidence,
    seniority,
    workFormat,
    geo
  );

  const priority = scoreToPriority(score);
  const confidence = scoreToConfidence(
    decision.decision,
    role,
    evidence
  );

  const shouldFetchFullPage = decision.decision !== 'REJECT';

  const diagnosticReasons = [];

  if (role.targetMatches.length) {
    diagnosticReasons.push(`target roles: ${names(role.targetMatches).join(', ')}`);
  }
  if (role.adjacentMatches.length) {
    diagnosticReasons.push(`adjacent roles: ${names(role.adjacentMatches).join(', ')}`);
  }
  if (role.offTargetMatches.length) {
    diagnosticReasons.push(`off-target warnings: ${names(role.offTargetMatches).join(', ')}`);
  }
  if (evidence.substantiveAiCategories.length) {
    diagnosticReasons.push(`AI categories: ${evidence.substantiveAiCategories.join(', ')}`);
  }
  if (evidence.implCategories.length) {
    diagnosticReasons.push(`AI implementation: ${evidence.implCategories.join(', ')}`);
  }
  if (evidence.coreWorkCategories.length) {
    diagnosticReasons.push(`core AI work: ${evidence.coreWorkCategories.join(', ')}`);
  }
  if (evidence.incidentalCategories.length) {
    diagnosticReasons.push(`incidental AI hints: ${evidence.incidentalCategories.join(', ')}`);
  }

  result.push({
    pairedItem: { item: inputIndex },
    json: {
      ...item.json,

      // ---------------- Pre-filter decision ----------------
      prefilter_version: PREFILTER_VERSION,
      prefilter_decision: decision.decision,
      prefilter_decision_code: decision.code,
      prefilter_passed: shouldFetchFullPage,
      should_fetch_full_page: shouldFetchFullPage,
      prefilter_score: score,
      prefilter_priority: priority,
      relevance_confidence: confidence,
      prefilter_reasons: uniq([
        ...decision.reasons,
        ...diagnosticReasons,
      ]),
      prefilter_warnings: uniq(decision.warnings),
      prefilter_rejection_reasons: uniq(decision.rejectionReasons),

      // ---------------- Parsed Habr RSS ----------------
      rss_parsed_vacancy_title: parsed.vacancy_title_raw,
      rss_parsed_skills: parsed.rss_skills,
      normalized_title: parsed.vacancy_title_normalized,

      // ---------------- Role classification ----------------
      title_role_class: role.roleClass,
      target_role_tier: role.targetTier,
      matched_target_roles: names(role.targetMatches),
      matched_adjacent_roles: names(role.adjacentMatches),
      matched_off_target_roles: names(role.offTargetMatches),
      matched_absolute_off_target_roles: names(role.absoluteOffTarget),
      matched_soft_off_target_roles: names(role.softOffTarget),
      matched_stack_off_target_roles: names(role.stackOffTarget),

      // ---------------- AI evidence by source ----------------
      matched_ai_categories_title: evidence.titleAiCategories,
      matched_ai_categories_skills: evidence.skillAiCategories,
      matched_ai_categories_narrative: evidence.narrativeAiCategories,
      matched_ai_categories_all: evidence.allAiCategories,
      matched_substantive_ai_categories: evidence.substantiveAiCategories,

      matched_ai_signals_title: names(evidence.aiTitleMatches),
      matched_ai_signals_skills: names(evidence.aiSkillMatches),
      matched_ai_signals_narrative: names(evidence.aiNarrativeMatches),

      matched_ai_implementation_signals: names(evidence.allImplMatches),
      matched_ai_implementation_categories: evidence.implCategories,
      matched_generic_tech_signals: names(evidence.allGenericMatches),

      matched_core_ai_work_signals: names(evidence.coreWorkMatches),
      matched_core_ai_work_categories: evidence.coreWorkCategories,
      matched_incidental_ai_signals: names(evidence.incidentalMatches),
      matched_incidental_ai_categories: evidence.incidentalCategories,
      incidental_ai_only: evidence.incidentalOnly,

      ai_priority_tier_a_count: evidence.tierACount,
      ai_priority_tier_b_count: evidence.tierBCount,
      ai_priority_tier_c_count: evidence.tierCCount,

      // ---------------- Seniority ----------------
      matched_level_signals: seniority.level_matches,
      matched_level_categories: seniority.level_categories,
      experience_min_years_hint: seniority.experience_min_years_hint,
      experience_max_years_hint: seniority.experience_max_years_hint,
      matched_experience_signals: seniority.experience_matches,
      seniority_risk_hint: seniority.risk,

      // ---------------- Work format ----------------
      work_format_hint: workFormat.hint,
      work_format_confidence: workFormat.confidence,
      work_format_source: 'rss_text',
      work_format_conflict: workFormat.conflict,
      remote_signal: workFormat.remote_signal,
      hybrid_signal: workFormat.hybrid_signal,
      office_signal: workFormat.office_signal,
      remote_denied_signal: workFormat.remote_denied_signal,

      // ---------------- Geography ----------------
      tbilisi_signal: geo.tbilisi_signal,
      georgia_signal: geo.georgia_signal,
      geo_format_policy: geo.policy,
      needs_full_page_geo_check: geo.needs_full_page_geo_check,

      // Salary is intentionally not used anywhere in this pre-filter.
      salary_filter_applied: false,
    },
  });
}

// PASS first, then REVIEW, then REJECT.
// Within a decision bucket: highest score first, then newest vacancy.
result.sort((a, b) => {
  const decisionDiff =
    decisionRank(a.json.prefilter_decision) -
    decisionRank(b.json.prefilter_decision);

  if (decisionDiff !== 0) return decisionDiff;

  const scoreDiff =
    (b.json.prefilter_score ?? 0) -
    (a.json.prefilter_score ?? 0);

  if (scoreDiff !== 0) return scoreDiff;

  const aDate = Date.parse(a.json.isoDate ?? a.json.pubDate ?? '') || 0;
  const bDate = Date.parse(b.json.isoDate ?? b.json.pubDate ?? '') || 0;

  return bDate - aDate;
});

return result;
