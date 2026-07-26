const fs = require('node:fs');
const path = require('node:path');

const code = fs.readFileSync(
  path.join(__dirname, '..', 'n8n', 'code', 'candidate-profile.js'),
  'utf8',
);

const runNode = new Function('$input', code);

function run(overrides = {}) {
  return runNode({
    item: {
      json: {
        vacancy_key: 'habr:test',
        title: 'Junior AI Engineer',
        should_continue_to_candidate_profile: true,
        ...overrides,
      },
    },
  }).json;
}

const eligible = run();
const blocked = run({ should_continue_to_candidate_profile: false });
const profile = eligible.candidate_profile;
const scorer = eligible.candidate_profile_for_scorer;
const serialized = JSON.stringify(profile);
const scorerSerialized = JSON.stringify(scorer);
const markSkills = new Set(
  profile.demonstrated_skills
    .filter((skill) => skill.evidence.includes('MARK'))
    .map((skill) => skill.name),
);
const promptSkill = profile.demonstrated_skills.find(
  (skill) => skill.name === 'Prompt engineering',
);
const projectNames = new Set(profile.projects.map((project) => project.name));
const demonstratedSkillNames = new Set(profile.demonstrated_skills.map((skill) => skill.name));

const requiredMarkSkills = [
  'n8n workflow orchestration',
  'JavaScript data processing in n8n Code nodes',
  'RSS and HTTP source integration',
  'Structured vacancy normalization',
  'Explainable deterministic classification',
  'Regression testing for workflow logic',
  'Workflow debugging and data lineage',
  'Git, GitHub and documentation workflow',
];

const checks = [
  ['preserves vacancy', eligible.vacancy_key === 'habr:test'],
  ['attaches profile', eligible.candidate_profile_attached === true],
  ['continues to scorer', eligible.should_continue_to_nvidia_scorer === true],
  ['stable profile schema', eligible.candidate_profile_schema === 'mark.candidate_profile.v1'],
  ['profile version 1.4.0', eligible.candidate_profile_version === '1.4.0'],
  ['compact scorer schema', scorer.schema === 'mark.candidate_for_scorer.v1'],
  ['compact scorer version', scorer.profile_version === '1.4.0'],
  ['commercial AI experience is false', profile.truth_policy.commercial_ai_experience === false],
  ['production AI experience is not proven', profile.truth_policy.production_ai_experience_proven === false],
  ['personal projects are not employment', profile.truth_policy.personal_projects_are_commercial_experience === false],
  ['projects are not commercial', profile.projects.every((project) => project.commercial === false)],
  ['projects are not production proven', profile.projects.every((project) => project.production_proven === false)],
  ['ARIADNE project is present', projectNames.has('ARIADNE')],
  ['Main Server project is present', projectNames.has('Main Server')],
  ['all MARK skills are present', requiredMarkSkills.every((skill) => markSkills.has(skill))],
  ['FastAPI is demonstrated', demonstratedSkillNames.has('FastAPI REST API development')],
  ['SQL migrations are demonstrated', demonstratedSkillNames.has('SQLite persistence and Alembic migrations')],
  ['PostgreSQL operations are demonstrated', demonstratedSkillNames.has('PostgreSQL migration, backup and restore')],
  ['Docker Compose is demonstrated', demonstratedSkillNames.has('Docker Compose and container operations')],
  ['Linux administration is demonstrated', demonstratedSkillNames.has('Linux server administration and systemd')],
  ['private networking is demonstrated', demonstratedSkillNames.has('Private service networking with Tailscale')],
  ['secret-safe operations are demonstrated', demonstratedSkillNames.has('Secret management and privacy-safe operations')],
  ['automated testing is demonstrated', demonstratedSkillNames.has('Automated backend, frontend and workflow testing')],
  ['primary roles are realistic', profile.target_roles.tier_a.includes('Junior AI Engineer')],
  ['RAG is not a primary role', !profile.target_roles.tier_a.includes('RAG Engineer')],
  ['LLMOps is not a primary role', !profile.target_roles.tier_a.includes('LLMOps Engineer')],
  ['prompt engineering is not attributed to MARK yet', !promptSkill.evidence.includes('MARK')],
  ['faster-whisper is not claimed', !/faster-whisper/i.test(serialized)],
  ['FastAPI is no longer a gap', !profile.known_gaps.some((gap) => gap.name === 'FastAPI')],
  ['SQL and PostgreSQL are no longer a gap', !profile.known_gaps.some((gap) => gap.name === 'SQL and PostgreSQL')],
  ['Docker is no longer a gap', !profile.known_gaps.some((gap) => gap.name === 'Docker')],
  ['Python testing is no longer a gap', !profile.known_gaps.some((gap) => gap.name === 'Python automated testing frameworks')],
  ['salary is not a filter', profile.work_preferences.salary_filter_applied === false],
  ['remote is not assumed worldwide', profile.work_preferences.remote.allowed_from_any_location === false],
  ['remote requires Georgia confirmation', profile.work_preferences.remote.requires_work_from_georgia_confirmation === true],
  ['verification is mixed not warning', eligible.candidate_profile_verification_status === 'mixed' && eligible.candidate_profile_warnings.length === 0],
  ['scorer snapshot omits verbose scope', !scorerSerialized.includes('"scope"')],
  ['scorer snapshot omits future roles', !scorerSerialized.includes('Data Scientist')],
  ['scorer snapshot has no score thresholds', !/(apply_min|review_min|skip_max|score_threshold)/.test(scorerSerialized)],
  ['scorer snapshot is materially smaller', scorerSerialized.length < serialized.length * 0.65],
  ['scorer snapshot stays under 10 KB', Buffer.byteLength(scorerSerialized, 'utf8') < 10_000],
  ['blocked upstream does not continue', blocked.should_continue_to_nvidia_scorer === false],
  ['blocked upstream has no scorer snapshot', blocked.candidate_profile_for_scorer === null],
  ['blocked upstream is explained', blocked.candidate_profile_errors.includes('upstream_level_filter_not_passed')],
  ['no email address', !/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(serialized)],
  ['no obvious API key', !/(?:nvapi-|sk-|gh[pousr]_)[A-Za-z0-9_-]{12,}/.test(serialized)],
];

const failures = checks.filter(([, passed]) => !passed);

if (failures.length > 0) {
  for (const [name] of failures) {
    console.error('FAIL', name);
  }
  console.error({
    profileBytes: Buffer.byteLength(serialized, 'utf8'),
    scorerBytes: Buffer.byteLength(scorerSerialized, 'utf8'),
  });
  process.exitCode = 1;
} else {
  console.log(`PASS: ${checks.length} candidate-profile checks`);
  console.log(
    `PROFILE SIZE: ${Buffer.byteLength(serialized, 'utf8')} bytes; ` +
      `SCORER SNAPSHOT: ${Buffer.byteLength(scorerSerialized, 'utf8')} bytes`,
  );
}
