const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PROFILE_PATH = path.join(ROOT, 'config', 'models', 'profiles', 'mark.json');
const profile = JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8'));
const ids = new Set();
let checks = 0;

function assert(condition, message) {
  checks += 1;
  if (!condition) throw new Error(message);
}

assert(profile.schema_version === 'mark.model_profile.v1', 'Unexpected profile schema');
assert(Array.isArray(profile.models) && profile.models.length > 0, 'Profile must contain models');

for (const entry of profile.models) {
  assert(!ids.has(entry.id), `Duplicate profile model id: ${entry.id}`);
  ids.add(entry.id);

  const configPath = path.resolve(path.dirname(PROFILE_PATH), entry.config);
  assert(fs.existsSync(configPath), `Missing config: ${entry.config}`);
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  assert(config.schema_version === 'mark.model_config.v1', `Bad schema: ${entry.id}`);
  assert(config.id === entry.id, `Entry/config id mismatch: ${entry.id}`);
  assert(config.provider === 'nvidia', `Unexpected provider: ${entry.id}`);
  assert(config.transport === 'openai_chat_completions', `Unsupported MARK transport: ${entry.id}`);
  assert(config.endpoint === 'https://integrate.api.nvidia.com/v1/chat/completions', `Bad endpoint: ${entry.id}`);
  assert(/^[^/]+\/.+/.test(config.model), `Model ID must be publisher/model: ${entry.id}`);
  assert(Array.isArray(config.modalities.input) && config.modalities.input.length > 0, `Missing input modalities: ${entry.id}`);
  assert(config.modalities.input.includes('text'), `MARK scorer requires text input: ${entry.id}`);
  assert(config.modalities.output.includes('text'), `MARK scorer requires text output: ${entry.id}`);
  assert(config.request_defaults.temperature >= 0, `Bad temperature: ${entry.id}`);
  assert(config.request_defaults.top_p > 0 && config.request_defaults.top_p <= 1, `Bad top_p: ${entry.id}`);
  assert(Number.isInteger(config.request_defaults.max_tokens), `Bad max_tokens: ${entry.id}`);
  assert(Number.isInteger(config.request_defaults.timeout_ms), `Bad timeout: ${entry.id}`);
  assert(Number.isInteger(config.benchmark.timeout_ms), `Bad benchmark timeout: ${entry.id}`);

  if (config.id === 'nemotron-3-nano-30b-a3b') {
    assert(
      config.request_defaults.chat_template_kwargs?.enable_thinking === false,
      'Nemotron primary must disable thinking for strict JSON scoring',
    );
  }

  if (config.id === 'nemotron-3-super-120b-a12b') {
    assert(
      config.request_defaults.reasoning_effort === 'none',
      'Nemotron Super primary must disable reasoning for strict JSON scoring',
    );
    assert(config.status === 'approved', 'Nemotron Super must be the approved primary');
  }

  const serialized = JSON.stringify(config);
  assert(!/nvapi-[A-Za-z0-9_-]{8,}/.test(serialized), `Secret-like NVIDIA key found: ${entry.id}`);
  assert(!/Bearer\s+nvapi-/i.test(serialized), `Bearer key found: ${entry.id}`);
}

console.log(`PASS: ${checks} NVIDIA model config checks`);
