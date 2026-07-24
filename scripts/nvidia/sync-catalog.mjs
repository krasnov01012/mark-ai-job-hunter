import fs from 'node:fs/promises';
import path from 'node:path';

const BUILD_CATALOG_URL = 'https://build.nvidia.com/models';
const HOSTED_MODELS_URL = 'https://integrate.api.nvidia.com/v1/models';

function parseArgs(argv) {
  const options = {
    output: 'config/models/catalog/nvidia-build-catalog.json',
    keyFile: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--output') options.output = argv[++index];
    else if (argument === '--key-file') options.keyFile = argv[++index];
    else if (argument === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }

  return options;
}

function extractJsonObject(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') inString = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }

  throw new Error('Could not find the end of the embedded catalog object');
}

function decodeNextChunks(html) {
  return [...html.matchAll(/self\.__next_f\.push\(\[1,"((?:\\.|[^"\\])*)"\]\)/g)]
    .map((match) => JSON.parse(`"${match[1]}"`));
}

function extractCatalogPage(html) {
  const chunk = decodeNextChunks(html)
    .find((candidate) => candidate.includes('"resultPageTotal"'));

  if (!chunk) throw new Error('NVIDIA page does not contain embedded catalog data');

  const marker = chunk.indexOf('"resultPageTotal"');
  let cursor = marker;

  while (cursor >= 0) {
    cursor = chunk.lastIndexOf('{', cursor - 1);
    if (cursor < 0) break;

    try {
      const candidate = JSON.parse(extractJsonObject(chunk, cursor));
      if (
        Number.isInteger(candidate.resultTotal)
        && Number.isInteger(candidate.resultPageTotal)
        && Array.isArray(candidate.results)
      ) {
        return candidate;
      }
    } catch {
      // Continue walking back to the enclosing object.
    }
  }

  throw new Error('Could not parse the embedded NVIDIA catalog object');
}

function listValues(resource, key) {
  return resource.labels
    ?.find((label) => label.key === key)
    ?.values ?? [];
}

function attributeValue(resource, key) {
  return resource.attributes
    ?.find((attribute) => attribute.key === key)
    ?.value ?? null;
}

function normalizeCatalogResource(resource) {
  const nimTypes = listValues(resource, 'nimType');
  const publishers = listValues(resource, 'publisher');
  const general = listValues(resource, 'general');
  const playgroundTypes = listValues(resource, 'playgroundType');
  const inferenceProviders = listValues(resource, 'cloudPartnerType');

  return {
    catalog_resource_id: resource.resourceId,
    slug: resource.name,
    display_name: resource.displayName,
    description: resource.description,
    publisher: publishers[0] ?? null,
    date_created: resource.dateCreated,
    date_modified: resource.dateModified,
    resource_type: resource.resourceType,
    categories: [...new Set(general)].sort(),
    playground_types: [...new Set(playgroundTypes)].sort(),
    inference_providers: [...new Set(inferenceProviders)].sort(),
    availability: {
      free_endpoint: nimTypes.includes('Free Endpoint'),
      partner_endpoint: nimTypes.includes('Partner Endpoint'),
      download_available: nimTypes.includes('Download Available'),
      catalog_available_flag: attributeValue(resource, 'AVAILABLE'),
      preview: attributeValue(resource, 'PREVIEW') === 'true',
      deprecation_date: attributeValue(resource, 'DEPRECATION_DATE'),
    },
    hosted_api_model_ids: [],
  };
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { accept: 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Catalog request failed: HTTP ${response.status}`);
  return response.text();
}

async function readApiKey(keyFile) {
  if (!keyFile) return null;
  const key = (await fs.readFile(keyFile, 'utf8')).trim();
  if (!key.startsWith('nvapi-')) {
    throw new Error('The key file does not contain an NVIDIA key starting with nvapi-');
  }
  return key;
}

async function fetchHostedModelIds(apiKey) {
  if (!apiKey) return [];

  const response = await fetch(HOSTED_MODELS_URL, {
    headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Hosted models request failed: HTTP ${response.status}`);

  const payload = await response.json();
  return [...new Set((payload.data ?? []).map((model) => model.id).filter(Boolean))].sort();
}

function attachHostedIds(models, hostedIds) {
  const idsBySlug = new Map();
  for (const modelId of hostedIds) {
    const slug = modelId.split('/').at(-1)?.toLowerCase();
    if (!slug) continue;
    if (!idsBySlug.has(slug)) idsBySlug.set(slug, []);
    idsBySlug.get(slug).push(modelId);
  }

  for (const model of models) {
    model.hosted_api_model_ids = idsBySlug.get(model.slug.toLowerCase()) ?? [];
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node scripts/nvidia/sync-catalog.mjs [--output path] [--key-file path]');
    return;
  }

  const firstPage = extractCatalogPage(await fetchText(`${BUILD_CATALOG_URL}?page=1`));
  const resources = firstPage.results.flatMap((group) => group.resources ?? []);

  for (let page = 2; page <= firstPage.resultPageTotal; page += 1) {
    const catalogPage = extractCatalogPage(await fetchText(`${BUILD_CATALOG_URL}?page=${page}`));
    resources.push(...catalogPage.results.flatMap((group) => group.resources ?? []));
  }

  const modelsByResourceId = new Map();
  for (const resource of resources) {
    modelsByResourceId.set(resource.resourceId, normalizeCatalogResource(resource));
  }

  const models = [...modelsByResourceId.values()]
    .sort((left, right) => left.display_name.localeCompare(right.display_name));
  const apiKey = await readApiKey(options.keyFile);
  const hostedModelIds = await fetchHostedModelIds(apiKey);
  attachHostedIds(models, hostedModelIds);

  const snapshot = {
    schema_version: 'mark.nvidia_catalog_snapshot.v1',
    source: BUILD_CATALOG_URL,
    fetched_at: new Date().toISOString(),
    catalog_reported_total: firstPage.resultTotal,
    catalog_pages: firstPage.resultPageTotal,
    unique_catalog_models: models.length,
    hosted_api_source: apiKey ? HOSTED_MODELS_URL : null,
    hosted_api_model_count: hostedModelIds.length,
    notes: [
      'Catalog cards include downloadable and partner endpoints, not only hosted chat models.',
      'hosted_api_model_ids are matched conservatively by the model slug returned from /v1/models.',
      'Presence in the catalog or /v1/models does not prove that a completion request will succeed.',
    ],
    hosted_api_model_ids: hostedModelIds,
    models,
  };

  const outputPath = path.resolve(options.output);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify({
    output: outputPath,
    catalog_reported_total: snapshot.catalog_reported_total,
    unique_catalog_models: snapshot.unique_catalog_models,
    hosted_api_model_count: snapshot.hosted_api_model_count,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
