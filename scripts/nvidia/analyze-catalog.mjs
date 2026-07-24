import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_INPUT = 'config/models/catalog/nvidia-build-catalog.json';
const DEFAULT_OUTPUT = 'config/models/catalog/nvidia-model-analysis.json';

function parseArgs(argv) {
  const options = { input: DEFAULT_INPUT, output: DEFAULT_OUTPUT };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--input') options.input = argv[++index];
    else if (argv[index] === '--output') options.output = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return options;
}

function normalizedText(model) {
  return [
    model.slug,
    model.display_name,
    model.description,
    ...model.categories,
    ...model.playground_types,
  ].join(' ').toLowerCase();
}

function classify(model) {
  const text = normalizedText(model);
  const has = (pattern) => pattern.test(text);

  if (has(/drug|molecul|protein|bionemo|biology|docking|genom|chemistry/)) return 'biology_drug_discovery';
  if (has(/text.to.speech|\btts\b|voice synthesis|voice cloning|chatterbox/)) return 'speech_synthesis';
  if (has(/speech.to.text|\basr\b|speech recognition|transcri/)) return 'speech_recognition';
  if (has(/embedding|text.to.embedding|embed-/)) return 'embedding';
  if (has(/rerank/)) return 'reranking';
  if (has(/safety|guardrail|pii|toxicity|moderation|detector/)) return 'safety_detection';
  if (has(/text.to.image|image generation|image editing|diffusion|flux\.|qwen-image/)) return 'image_generation_editing';
  if (has(/video generation|video understanding|lipsync|relighting|active speaker|broadcast|cosmos/)) return 'video_media';
  if (has(/ocr|table extraction|page elements|graphic elements|document parsing|object detection/)) return 'document_vision';
  if (has(/robot|physical ai|autonomous vehicle|world model/)) return 'physical_ai_robotics';
  if (has(/multimodal|image.to.text|\bvlm\b|vision.language|omni/)) return 'multimodal_language';
  if (has(/text.to.text|language generation|\bchat\b|reasoning|coding|agentic|instruction following|tool use/)) return 'language_reasoning';
  return 'other_specialized';
}

function markRelevance(family) {
  if (family === 'language_reasoning') return 'current_mark_scorer';
  if (family === 'multimodal_language') return 'future_multimodal_extension';
  if (family === 'embedding' || family === 'reranking') return 'post_mvp_retrieval_only';
  if (family === 'safety_detection') return 'optional_future_guardrail';
  return 'not_required_for_mark_mvp';
}

function capabilityScore(model) {
  const text = normalizedText(model);
  let score = 0;
  const add = (pattern, points) => { if (pattern.test(text)) score += points; };
  add(/frontier|flagship|state.of.the.art/, 20);
  add(/reasoning/, 12);
  add(/agentic|agent-ready|\bagent\b/, 10);
  add(/instruction following|instruct/, 8);
  add(/tool use|tool calling/, 6);
  add(/coding/, 4);
  add(/long context|1m.context|1m-token/, 4);
  if (model.availability.free_endpoint) score += 5;
  if (model.hosted_api_model_ids.length) score += 8;
  if (model.availability.deprecation_date) score -= 100;
  return score;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const input = JSON.parse(await fs.readFile(path.resolve(options.input), 'utf8'));
  const models = input.models.map((model) => {
    const family = classify(model);
    return {
      catalog_resource_id: model.catalog_resource_id,
      slug: model.slug,
      display_name: model.display_name,
      publisher: model.publisher,
      description: model.description,
      model_family: family,
      mark_relevance: markRelevance(family),
      catalog_capability_score: capabilityScore(model),
      categories: model.categories,
      availability: model.availability,
      hosted_api_model_ids: model.hosted_api_model_ids,
    };
  });

  const familyCounts = {};
  for (const model of models) familyCounts[model.model_family] = (familyCounts[model.model_family] ?? 0) + 1;

  const analysis = {
    schema_version: 'mark.nvidia_catalog_analysis.v1',
    source_snapshot: path.relative(process.cwd(), path.resolve(options.input)).replaceAll('\\', '/'),
    generated_at: new Date().toISOString(),
    analyzed_models: models.length,
    methodology: [
      'Every catalog card is assigned exactly one primary family using transparent keyword rules.',
      'catalog_capability_score ranks catalog claims and availability; it is not an independent quality benchmark.',
      'MARK runtime approval requires a successful live benchmark and a scorer-specific evaluation set.',
    ],
    family_counts: familyCounts,
    strongest_catalog_candidates: models
      .filter((model) => ['language_reasoning', 'multimodal_language'].includes(model.model_family))
      .sort((left, right) => right.catalog_capability_score - left.catalog_capability_score)
      .slice(0, 25)
      .map((model) => ({
        slug: model.slug,
        publisher: model.publisher,
        model_family: model.model_family,
        catalog_capability_score: model.catalog_capability_score,
        hosted_api_model_ids: model.hosted_api_model_ids,
      })),
    models,
  };

  const outputPath = path.resolve(options.output);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(analysis, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output: outputPath, analyzed_models: models.length, family_counts: familyCounts }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
