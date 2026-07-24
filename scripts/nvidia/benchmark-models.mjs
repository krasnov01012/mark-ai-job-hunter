import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_PROFILE = 'config/models/profiles/mark.json';
const DEFAULT_OUTPUT = 'reports/nvidia/benchmark-latest.json';

function parseArgs(argv) {
  const options = {
    profile: DEFAULT_PROFILE,
    output: DEFAULT_OUTPUT,
    keyFile: null,
    modelIds: null,
    timeoutMs: null,
    pauseMs: 2_000,
    runs: 1,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--profile') options.profile = argv[++index];
    else if (argument === '--output') options.output = argv[++index];
    else if (argument === '--key-file') options.keyFile = argv[++index];
    else if (argument === '--models') options.modelIds = argv[++index].split(',').map((value) => value.trim());
    else if (argument === '--timeout-ms') options.timeoutMs = Number(argv[++index]);
    else if (argument === '--pause-ms') options.pauseMs = Number(argv[++index]);
    else if (argument === '--runs') options.runs = Number(argv[++index]);
    else if (argument === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }

  return options;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function loadApiKey(keyFile) {
  const key = keyFile
    ? (await fs.readFile(keyFile, 'utf8')).trim()
    : process.env.NVIDIA_API_KEY?.trim();

  if (!key?.startsWith('nvapi-')) {
    throw new Error('Provide NVIDIA_API_KEY or --key-file with an nvapi- key');
  }
  return key;
}

function safeError(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'timeout';
  return String(error?.message ?? error).slice(0, 500);
}

function tryParseJsonContent(content) {
  if (typeof content !== 'string') return { valid: false, value: null };
  try {
    return { valid: true, value: JSON.parse(content) };
  } catch {
    return { valid: false, value: null };
  }
}

async function benchmarkModel(config, apiKey, timeoutOverride) {
  const timeoutMs = timeoutOverride ?? config.benchmark.timeout_ms;
  const started = performance.now();
  const requestBody = {
    model: config.model,
    messages: [
      { role: 'system', content: 'Return valid JSON only.' },
      { role: 'user', content: 'Return exactly: {"status":"ok","task":"mark-model-test"}' },
    ],
    max_tokens: 64,
    temperature: config.request_defaults.temperature,
    top_p: config.request_defaults.top_p,
    stream: false,
  };

  if (config.request_defaults.chat_template_kwargs) {
    requestBody.chat_template_kwargs = config.request_defaults.chat_template_kwargs;
  }

  if (config.request_defaults.reasoning_effort) {
    requestBody.reasoning_effort = config.request_defaults.reasoning_effort;
  }

  try {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const body = await response.text();
    const totalMs = Math.round(performance.now() - started);
    let payload = null;
    try { payload = JSON.parse(body); } catch { /* Preserve body metadata only. */ }

    const content = payload?.choices?.[0]?.message?.content ?? null;
    const parsedContent = tryParseJsonContent(content);
    const completionTokens = payload?.usage?.completion_tokens ?? null;

    return {
      config_id: config.id,
      requested_model: config.model,
      reported_model: payload?.model ?? null,
      ok: response.ok,
      http_status: response.status,
      total_ms: totalMs,
      timeout_ms: timeoutMs,
      completion_tokens: completionTokens,
      approximate_completion_tokens_per_second:
        completionTokens && totalMs > 0
          ? Number((completionTokens / (totalMs / 1000)).toFixed(2))
          : null,
      json_content_valid: parsedContent.valid,
      contract_match:
        parsedContent.value?.status === 'ok'
        && parsedContent.value?.task === 'mark-model-test',
      finish_reason: payload?.choices?.[0]?.finish_reason ?? null,
      error: response.ok ? null : (payload?.detail ?? payload?.title ?? `HTTP ${response.status}`),
    };
  } catch (error) {
    return {
      config_id: config.id,
      requested_model: config.model,
      reported_model: null,
      ok: false,
      http_status: null,
      total_ms: Math.round(performance.now() - started),
      timeout_ms: timeoutMs,
      completion_tokens: null,
      approximate_completion_tokens_per_second: null,
      json_content_valid: false,
      contract_match: false,
      finish_reason: null,
      error: safeError(error),
    };
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node scripts/nvidia/benchmark-models.mjs --key-file path [--profile path] [--models id,id] [--runs n]');
    return;
  }

  if (!Number.isInteger(options.runs) || options.runs < 1 || options.runs > 10) {
    throw new Error('--runs must be an integer from 1 to 10');
  }

  const profilePath = path.resolve(options.profile);
  const profile = await readJson(profilePath);
  const profileDirectory = path.dirname(profilePath);
  const selectedEntries = profile.models.filter((entry) => (
    !options.modelIds || options.modelIds.includes(entry.id)
  ));

  if (!selectedEntries.length) throw new Error('No models selected for benchmark');

  const configs = [];
  for (const entry of selectedEntries) {
    const config = await readJson(path.resolve(profileDirectory, entry.config));
    if (config.transport !== 'openai_chat_completions') {
      throw new Error(`Benchmark does not support transport ${config.transport}: ${config.id}`);
    }
    configs.push(config);
  }

  const apiKey = await loadApiKey(options.keyFile);
  const results = [];

  const totalRequests = configs.length * options.runs;
  let requestIndex = 0;
  for (const config of configs) {
    for (let run = 1; run <= options.runs; run += 1) {
      requestIndex += 1;
      console.log(`Testing ${config.model} run ${run}/${options.runs} (${requestIndex}/${totalRequests})...`);
      const result = await benchmarkModel(config, apiKey, options.timeoutMs);
      results.push({ ...result, run });
      if (requestIndex < totalRequests && options.pauseMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.pauseMs));
      }
    }
  }

  const percentile = (values, fraction) => {
    if (!values.length) return null;
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
  };
  const summary = configs.map((config) => {
    const modelResults = results.filter((result) => result.config_id === config.id);
    const successful = modelResults.filter((result) => result.ok);
    const contractMatches = modelResults.filter((result) => result.contract_match);
    const latencies = successful.map((result) => result.total_ms);
    return {
      config_id: config.id,
      model: config.model,
      runs: modelResults.length,
      success_rate: Number((successful.length / modelResults.length).toFixed(3)),
      contract_rate: Number((contractMatches.length / modelResults.length).toFixed(3)),
      median_total_ms: percentile(latencies, 0.5),
      p95_total_ms: percentile(latencies, 0.95),
      errors: [...new Set(modelResults.map((result) => result.error).filter(Boolean))],
    };
  });

  const report = {
    schema_version: 'mark.nvidia_benchmark.v1',
    generated_at: new Date().toISOString(),
    profile_id: profile.id,
    test_contract: { status: 'ok', task: 'mark-model-test' },
    sequential: true,
    pause_ms: options.pauseMs,
    runs_per_model: options.runs,
    summary,
    results,
  };

  const outputPath = path.resolve(options.output);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.table(results.map((result) => ({
    model: result.requested_model,
    ok: result.ok,
    status: result.http_status,
    total_ms: result.total_ms,
    json: result.json_content_valid,
    contract: result.contract_match,
    error: result.error,
  })));
  console.table(summary);
  console.log(`Report: ${outputPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
