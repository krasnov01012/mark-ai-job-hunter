/**
 * MARK — Candidate Profile
 * Version: 1.2.0
 * n8n Code node mode: Run Once for Each Item
 *
 * Keeps a complete audit profile and produces a compact, readable snapshot
 * for NVIDIA Scorer. Contains no credentials or personal contact data.
 */

const CANDIDATE_PROFILE_VERSION = '1.2.0';
const CANDIDATE_PROFILE_SCHEMA = 'mark.candidate_profile.v1';
const SCORER_SNAPSHOT_SCHEMA = 'mark.candidate_for_scorer.v1';

const ALLOWED_EVIDENCE_LEVELS = new Set([
  'repository_verified',
  'user_reported_project',
]);

const ALLOWED_PROFICIENCY_LEVELS = new Set([
  'project_applied',
  'basic',
  'limited',
  'not_demonstrated',
]);

const CANDIDATE_PROFILE = {
  schema_version: CANDIDATE_PROFILE_SCHEMA,
  profile_version: CANDIDATE_PROFILE_VERSION,
  profile_id: 'mark_primary_candidate',

  truth_policy: {
    commercial_ai_experience: false,
    production_ai_experience_proven: false,
    personal_projects_are_commercial_experience: false,
    do_not_invent_skills_or_experience: true,
    do_not_hide_material_gaps: true,
    do_not_infer_proficiency_from_skill_name: true,
    do_not_treat_target_role_as_demonstrated_skill: true,
    do_not_treat_tool_presence_as_mastery: true,
    treat_missing_evidence_as_unknown_not_proven: true,
  },

  evidence_policy: {
    repository_verified_weight: 'high',
    user_reported_project_weight: 'medium',
    production_claim_requires_production_evidence: true,
    commercial_claim_requires_employment_evidence: true,
  },

  career_positioning: {
    current_positioning: [
      'Junior AI Engineer',
      'Python AI Developer',
      'LLM Integration Developer',
      'AI Automation Developer',
      'AI Assistant Developer',
    ],
    do_not_position_as: [
      'Senior Developer',
      'Software Architect',
      'ML Researcher',
      'Production ML Engineer',
      'Data Scientist',
    ],
  },

  target_roles: {
    tier_semantics: {
      tier_a: 'primary_current_targets',
      tier_b: 'reasonable_stretch_targets',
      tier_c: 'future_targets_after_gap_closure',
    },
    tier_a: [
      'Junior AI Engineer',
      'Python AI Developer',
      'LLM Integration Developer',
      'AI Automation Developer',
      'AI Assistant Developer',
      'Junior LLM Engineer',
    ],
    tier_b: [
      'AI Engineer',
      'LLM Engineer',
      'AI Agent Developer',
      'GenAI Engineer',
      'Conversational AI Engineer',
      'Prompt Engineer',
    ],
    tier_c: [
      'RAG Engineer',
      'LLMOps Engineer',
      'NLP Engineer',
      'ML Engineer',
      'Inference Engineer',
      'Fine-tuning Engineer',
      'MLOps Engineer',
      'Data Scientist',
      'Computer Vision Engineer',
      'Speech AI Engineer',
    ],
    preferred_levels: ['intern', 'junior', 'junior_plus'],
    stretch_levels: ['middle', 'middle_plus', 'unknown'],
    excluded_levels: ['senior', 'lead', 'principal', 'staff', 'head', 'architect'],
  },

  demonstrated_skills: [
    {
      name: 'Python',
      category: 'programming',
      proficiency: 'project_applied',
      evidence_level: 'user_reported_project',
      evidence: ['EDITH'],
      scope: [
        'modular application logic',
        'LLM provider integration',
        'memory and context components',
        'local system actions',
      ],
    },
    {
      name: 'LLM API integration',
      category: 'ai_integration',
      proficiency: 'project_applied',
      evidence_level: 'user_reported_project',
      evidence: ['EDITH'],
      scope: ['OpenAI-compatible client', 'model requests', 'timeouts', 'error handling'],
    },
    {
      name: 'NVIDIA API integration',
      category: 'ai_integration',
      proficiency: 'project_applied',
      evidence_level: 'user_reported_project',
      evidence: ['EDITH'],
      scope: ['NVIDIA OpenAI-compatible API', 'model configuration', 'provider wrapper'],
    },
    {
      name: 'Prompt engineering',
      category: 'ai_engineering',
      proficiency: 'project_applied',
      evidence_level: 'user_reported_project',
      evidence: ['EDITH'],
      scope: ['system prompts', 'context injection', 'memory injection', 'response control'],
    },
    {
      name: 'Modular AI assistant architecture',
      category: 'software_design',
      proficiency: 'project_applied',
      evidence_level: 'user_reported_project',
      evidence: ['EDITH'],
      scope: ['orchestration', 'provider layer', 'memory layer', 'system actions', 'voice pipeline'],
    },
    {
      name: 'Context and memory systems',
      category: 'ai_engineering',
      proficiency: 'project_applied',
      evidence_level: 'user_reported_project',
      evidence: ['EDITH'],
      scope: ['conversation context', 'profile memory', 'memory injection into prompts'],
    },
    {
      name: 'Provider abstraction',
      category: 'software_design',
      proficiency: 'project_applied',
      evidence_level: 'user_reported_project',
      evidence: ['EDITH'],
      scope: ['common provider interface', 'provider routing', 'replaceable model provider'],
    },
    {
      name: 'Speech-to-Text integration',
      category: 'voice_ai',
      proficiency: 'project_applied',
      evidence_level: 'user_reported_project',
      evidence: ['EDITH'],
      scope: ['microphone input', 'speech recognition', 'voice command pipeline'],
    },
    {
      name: 'Text-to-Speech integration',
      category: 'voice_ai',
      proficiency: 'project_applied',
      evidence_level: 'user_reported_project',
      evidence: ['EDITH'],
      scope: ['voice response generation', 'audio playback', 'TTS output cleanup'],
    },
    {
      name: 'n8n workflow orchestration',
      category: 'automation',
      proficiency: 'project_applied',
      evidence_level: 'repository_verified',
      evidence: ['MARK'],
      scope: ['multi-stage pipeline', 'branching', 'item linking', 'filters', 'external integrations'],
    },
    {
      name: 'JavaScript data processing in n8n Code nodes',
      category: 'programming',
      proficiency: 'project_applied',
      evidence_level: 'repository_verified',
      evidence: ['MARK'],
      scope: ['null-safe transformations', 'Unicode matching', 'classification', 'upstream data preservation'],
    },
    {
      name: 'RSS and HTTP source integration',
      category: 'integration',
      proficiency: 'project_applied',
      evidence_level: 'repository_verified',
      evidence: ['MARK'],
      scope: ['Habr RSS ingestion', 'full-page loading', 'GUID identification'],
    },
    {
      name: 'Structured vacancy normalization',
      category: 'data_processing',
      proficiency: 'project_applied',
      evidence_level: 'repository_verified',
      evidence: ['MARK'],
      scope: ['SSR JSON', 'JSON-LD fallback', 'HTML cleanup', 'common vacancy contract'],
    },
    {
      name: 'Explainable deterministic classification',
      category: 'data_processing',
      proficiency: 'project_applied',
      evidence_level: 'repository_verified',
      evidence: ['MARK'],
      scope: ['decision codes', 'reasons', 'warnings', 'evidence', 'confidence', 'policy gates'],
    },
    {
      name: 'Regression testing for workflow logic',
      category: 'testing',
      proficiency: 'project_applied',
      evidence_level: 'repository_verified',
      evidence: ['MARK'],
      scope: ['positive cases', 'negative cases', 'boundary cases', 'truth-policy checks'],
    },
    {
      name: 'Workflow debugging and data lineage',
      category: 'debugging',
      proficiency: 'project_applied',
      evidence_level: 'repository_verified',
      evidence: ['MARK'],
      scope: ['paired items', 'Kept/Discarded branches', 'mock data', 'Code node synchronization'],
    },
    {
      name: 'Git, GitHub and documentation workflow',
      category: 'development_tools',
      proficiency: 'project_applied',
      evidence_level: 'repository_verified',
      evidence: ['MARK'],
      scope: ['checkpoints', 'diff review', 'private remote', 'documentation sync', 'secret checks'],
    },
  ],

  projects: [
    {
      name: 'EDITH',
      kind: 'personal_project',
      evidence_level: 'user_reported_project',
      commercial: false,
      production_proven: false,
      summary:
        'Local-first Python AI assistant with voice interaction, NVIDIA LLM integration, context and profile memory, provider abstraction, permission controls, and local system actions.',
      demonstrates: [
        'Python application development',
        'LLM API integration',
        'prompt construction',
        'memory and context design',
        'provider abstraction',
        'voice pipeline integration',
      ],
    },
    {
      name: 'MARK',
      kind: 'personal_project',
      evidence_level: 'repository_verified',
      commercial: false,
      production_proven: false,
      summary:
        'n8n and JavaScript job-monitoring pipeline with Habr RSS ingestion, normalization, explainable deterministic filters, regression checks, Git, and Telegram integration.',
      demonstrates: [
        'workflow orchestration',
        'JavaScript data processing',
        'RSS and HTTP integration',
        'structured normalization',
        'explainable classification',
        'testing and documentation',
      ],
    },
  ],

  known_gaps: [
    { name: 'Commercial AI engineering experience', level: 'none', gap_type: 'experience_barrier', severity: 'high_for_some_vacancies' },
    { name: 'Production deployment experience', level: 'not_proven', gap_type: 'experience_barrier', severity: 'medium' },
    { name: 'FastAPI', level: 'not_demonstrated', gap_type: 'learnable_technical_gap', severity: 'medium' },
    { name: 'SQL and PostgreSQL', level: 'not_demonstrated', gap_type: 'learnable_technical_gap', severity: 'medium' },
    { name: 'Docker', level: 'limited', gap_type: 'learnable_technical_gap', severity: 'medium' },
    { name: 'Production RAG', level: 'none', gap_type: 'learnable_technical_gap', severity: 'high_for_rag_roles' },
    { name: 'Vector databases', level: 'not_demonstrated', gap_type: 'learnable_technical_gap', severity: 'high_for_rag_roles' },
    { name: 'Production LangGraph', level: 'none', gap_type: 'learnable_technical_gap', severity: 'high_for_agent_roles' },
    { name: 'asyncio', level: 'limited', gap_type: 'learnable_technical_gap', severity: 'medium' },
    { name: 'Python automated testing frameworks', level: 'not_demonstrated', gap_type: 'learnable_technical_gap', severity: 'medium' },
    { name: 'CI/CD', level: 'limited', gap_type: 'learnable_technical_gap', severity: 'medium' },
    { name: 'ML model training', level: 'none', gap_type: 'specialization_gap', severity: 'high_for_ml_roles' },
    { name: 'PyTorch or TensorFlow', level: 'not_demonstrated', gap_type: 'specialization_gap', severity: 'high_for_ml_roles' },
    { name: 'Model fine-tuning', level: 'none', gap_type: 'specialization_gap', severity: 'high_for_finetuning_roles' },
  ],

  candidate_unknowns: [
    { name: 'English proficiency', policy: 'do_not_infer', impact: 'international_vacancies' },
    { name: 'Formal education requirements', policy: 'evaluate_only_if_required', impact: 'vacancy_specific' },
    { name: 'Work authorization outside target geography', policy: 'do_not_use_as_filter', impact: 'manual_verification_only' },
  ],

  work_preferences: {
    salary_filter_applied: false,
    missing_salary_allowed: true,
    remote: {
      allowed: true,
      allowed_from_any_location: true,
      location_restrictions_are_not_a_filter: true,
    },
    hybrid: { allowed: true, only_city: 'Tbilisi', only_country: 'Georgia' },
    office: { allowed: true, only_city: 'Tbilisi', only_country: 'Georgia' },
  },

  assessment_policy: {
    evaluate_transferable_project_experience: true,
    do_not_reject_only_for_missing_commercial_experience: true,
    distinguish_learnable_gap_from_experience_barrier: true,
    distinguish_required_skills_from_preferred_skills: true,
    distinguish_current_fit_from_future_target_role: true,
    treat_personal_projects_as_projects_not_employment: true,
    do_not_award_unproven_skill: true,
    do_not_assume_production_experience: true,
    do_not_penalize_unknown_data_unless_vacancy_requires_it: true,
    keep_salary_out_of_fit_score: true,
  },
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateProfile(profile) {
  const errors = [];

  if (profile.schema_version !== CANDIDATE_PROFILE_SCHEMA) {
    errors.push('candidate_profile_schema_mismatch');
  }
  if (profile.profile_version !== CANDIDATE_PROFILE_VERSION) {
    errors.push('candidate_profile_version_mismatch');
  }
  if (profile.truth_policy?.commercial_ai_experience !== false) {
    errors.push('commercial_ai_experience_must_be_false');
  }
  if (profile.truth_policy?.production_ai_experience_proven !== false) {
    errors.push('production_ai_experience_must_be_false');
  }
  if (!Array.isArray(profile.demonstrated_skills) || profile.demonstrated_skills.length === 0) {
    errors.push('candidate_skills_missing');
  }
  if (!Array.isArray(profile.known_gaps) || profile.known_gaps.length === 0) {
    errors.push('candidate_gaps_missing');
  }
  if (!Array.isArray(profile.projects) || profile.projects.length === 0) {
    errors.push('candidate_projects_missing');
  }

  const projectNames = new Set((profile.projects ?? []).map((project) => project.name));
  const skillNames = new Set();

  for (const skill of profile.demonstrated_skills ?? []) {
    if (!skill?.name) {
      errors.push('candidate_skill_name_missing');
      continue;
    }
    if (skillNames.has(skill.name)) {
      errors.push(`candidate_skill_duplicate:${skill.name}`);
    }
    skillNames.add(skill.name);

    if (!ALLOWED_EVIDENCE_LEVELS.has(skill.evidence_level)) {
      errors.push(`candidate_skill_invalid_evidence_level:${skill.name}`);
    }
    if (!ALLOWED_PROFICIENCY_LEVELS.has(skill.proficiency)) {
      errors.push(`candidate_skill_invalid_proficiency:${skill.name}`);
    }
    if (!Array.isArray(skill.evidence) || skill.evidence.length === 0) {
      errors.push(`candidate_skill_evidence_missing:${skill.name}`);
      continue;
    }
    for (const project of skill.evidence) {
      if (!projectNames.has(project)) {
        errors.push(`candidate_skill_unknown_evidence_project:${skill.name}:${project}`);
      }
    }
  }

  for (const project of profile.projects ?? []) {
    if (!ALLOWED_EVIDENCE_LEVELS.has(project.evidence_level)) {
      errors.push(`candidate_project_invalid_evidence_level:${project.name}`);
    }
    if (project.commercial !== false) {
      errors.push(`candidate_project_must_not_be_commercial:${project.name}`);
    }
    if (project.production_proven !== false) {
      errors.push(`candidate_project_production_must_be_false:${project.name}`);
    }
  }

  if (!Array.isArray(profile.target_roles?.tier_a) || profile.target_roles.tier_a.length === 0) {
    errors.push('candidate_primary_target_roles_missing');
  }
  if (!Array.isArray(profile.target_roles?.preferred_levels) || profile.target_roles.preferred_levels.length === 0) {
    errors.push('candidate_preferred_levels_missing');
  }
  if (!Array.isArray(profile.target_roles?.excluded_levels) || profile.target_roles.excluded_levels.length === 0) {
    errors.push('candidate_excluded_levels_missing');
  }
  if (profile.work_preferences?.salary_filter_applied !== false) {
    errors.push('candidate_salary_filter_must_be_disabled');
  }

  return errors;
}

function buildScorerSnapshot(profile) {
  return {
    schema: SCORER_SNAPSHOT_SCHEMA,
    profile_version: profile.profile_version,
    positioning: profile.career_positioning.current_positioning,
    truth: {
      commercial_ai_experience: false,
      production_ai_experience_proven: false,
      personal_projects_only: true,
    },
    targets: {
      primary: profile.target_roles.tier_a,
      stretch: profile.target_roles.tier_b,
      preferred_levels: profile.target_roles.preferred_levels,
      stretch_levels: profile.target_roles.stretch_levels,
      excluded_levels: profile.target_roles.excluded_levels,
    },
    skills: profile.demonstrated_skills.map((skill) => ({
      name: skill.name,
      level: skill.proficiency,
      evidence: `${skill.evidence.join('+')}:${skill.evidence_level}`,
    })),
    projects: profile.projects.map((project) => ({
      name: project.name,
      evidence: `${project.name}:${project.evidence_level}`,
      demonstrates: project.demonstrates,
    })),
    gaps: profile.known_gaps.map((gap) => ({
      name: gap.name,
      level: gap.level,
      type: gap.gap_type,
    })),
    unknowns: profile.candidate_unknowns.map((item) => ({
      name: item.name,
      policy: item.policy,
    })),
    work: {
      salary_is_not_a_filter: true,
      missing_salary_allowed: true,
      remote_from_georgia_requires_confirmation: false,
      remote_allowed_from_any_location: true,
      hybrid_or_office_only: 'Tbilisi, Georgia',
    },
    rules: Object.entries(profile.assessment_policy)
      .filter(([, enabled]) => enabled === true)
      .map(([rule]) => rule),
  };
}

const inputItem = $input.item;
const vacancy = inputItem?.json ?? {};
const profile = clone(CANDIDATE_PROFILE);
const errors = validateProfile(profile);

if (vacancy.should_continue_to_candidate_profile !== true) {
  errors.push('upstream_level_filter_not_passed');
}

const attached = errors.length === 0;
const hasUserReportedEvidence = profile.demonstrated_skills.some(
  (skill) => skill.evidence_level === 'user_reported_project',
);

return {
  ...inputItem,
  json: {
    ...vacancy,
    candidate_profile_schema: CANDIDATE_PROFILE_SCHEMA,
    candidate_profile_version: CANDIDATE_PROFILE_VERSION,
    candidate_profile_source: 'static_code_contract',
    candidate_profile_verification_status: hasUserReportedEvidence ? 'mixed' : 'verified',
    candidate_profile_attached: attached,
    candidate_profile_errors: errors,
    candidate_profile_warnings: [],
    candidate_profile: profile,
    candidate_profile_for_scorer: attached ? buildScorerSnapshot(profile) : null,
    should_continue_to_nvidia_scorer: attached,
  },
};
