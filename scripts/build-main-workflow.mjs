import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const workflowPath = path.join(root, 'n8n', 'workflows', 'ai-job-hunter-main.json');
const args = process.argv.slice(2);
const credentialSourceFlag = args.indexOf('--credential-source');
const credentialSourcePath = credentialSourceFlag >= 0
  ? path.resolve(args[credentialSourceFlag + 1])
  : null;
const stateSourceFlag = args.indexOf('--state-source');
const stateSourcePath = stateSourceFlag >= 0
  ? path.resolve(args[stateSourceFlag + 1])
  : null;
const dryRun = args.includes('--dry-run');

function readWorkflow(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return Array.isArray(parsed) ? parsed[0] : parsed;
}

function source(fileName) {
  return fs.readFileSync(path.join(root, 'n8n', 'code', fileName), 'utf8');
}

const base = readWorkflow(workflowPath);
const credentialSource = credentialSourcePath ? readWorkflow(credentialSourcePath) : base;
const stateSource = stateSourcePath ? readWorkflow(stateSourcePath) : base;
const existing = new Map(base.nodes.map((node) => [node.name, node]));
const credentialNodes = new Map(credentialSource.nodes.map((node) => [node.name, node]));

function existingNode(name) {
  const node = existing.get(name);
  if (!node) throw new Error(`Required base node is missing: ${name}`);
  return structuredClone(node);
}

function credential(type, candidates) {
  for (const name of candidates) {
    const value = credentialNodes.get(name)?.credentials?.[type] ?? existing.get(name)?.credentials?.[type];
    if (value?.id && value?.name) return { [type]: structuredClone(value) };
  }
  throw new Error(`Credential reference ${type} was not found in: ${candidates.join(', ')}`);
}

function credentialOrPlaceholder(type, candidates, placeholderName) {
  try {
    return credential(type, candidates);
  } catch {
    return {
      [type]: {
        id: `configure-${type}`,
        name: placeholderName,
      },
    };
  }
}

function codeNode({ id, name, file, position, mode = 'runOnceForEachItem' }) {
  return {
    parameters: {
      ...(mode === 'runOnceForAllItems' ? {} : { mode }),
      jsCode: source(file),
    },
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position,
    id,
    name,
  };
}

let conditionCounter = 0;
function condition(leftValue, type, operation, rightValue = '') {
  conditionCounter += 1;
  return {
    id: `00000000-0000-4000-8000-${conditionCounter.toString(16).padStart(12, '0')}`,
    leftValue,
    rightValue,
    operator: {
      type,
      operation,
      ...(type === 'boolean' ? { singleValue: true } : {}),
    },
  };
}

function filterNode({ id, name, position, conditions }) {
  return {
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: '',
          typeValidation: 'strict',
          version: 3,
        },
        conditions,
        combinator: 'and',
      },
      options: {},
    },
    type: 'n8n-nodes-base.filter',
    typeVersion: 2.3,
    position,
    id,
    name,
  };
}

function httpNode({ id, name, position, credentialRef, bodyField }) {
  return {
    parameters: {
      method: 'POST',
      url: 'https://integrate.api.nvidia.com/v1/chat/completions',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: `={{ JSON.stringify($json.${bodyField}) }}`,
      options: {
        response: {
          response: {
            fullResponse: true,
            neverError: true,
            responseFormat: 'json',
          },
        },
        timeout: 120000,
      },
    },
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.4,
    position,
    id,
    name,
    retryOnFail: false,
    waitBetweenTries: 2000,
    onError: 'continueRegularOutput',
    credentials: credentialRef,
  };
}

function hhHttpNode({ id, name, position, url, continueOnError = false }) {
  return {
    parameters: {
      url,
      authentication: 'genericCredentialType',
      genericAuthType: 'oAuth2Api',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'Accept', value: 'application/json' },
          { name: 'HH-User-Agent', value: 'MARK/1.0 (AI Job Hunter; owner contact in HH developer profile)' },
        ],
      },
      options: {
        response: {
          response: {
            fullResponse: true,
            neverError: true,
            responseFormat: 'json',
          },
        },
        timeout: 20000,
      },
    },
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.4,
    position,
    id,
    name,
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 2000,
    ...(continueOnError ? { onError: 'continueRegularOutput' } : {}),
    credentials: hhCredential,
  };
}

const primaryCredential = credential('httpHeaderAuth', [
  'NVIDIA Scorer — Primary',
  'NVIDIA API — Primary',
  'NVIDIA Connectivity Test',
]);
const secondaryCredential = credential('httpHeaderAuth', [
  'NVIDIA Scorer — Secondary',
  'NVIDIA Connectivity Test — Secondary',
  'NVIDIA API — Secondary',
]);
const telegramCredential = credential('telegramApi', [
  'Send MARK Vacancy Card',
  'Send a text message',
]);
const hhCredential = credentialOrPlaceholder('oAuth2Api', [
  'HH Search Vacancies',
  'Fetch HH Vacancy Details',
], 'MARK HeadHunter OAuth2');

const schedule = {
  parameters: {
    rule: {
      interval: [{ field: 'minutes', minutesInterval: 10 }],
    },
  },
  type: 'n8n-nodes-base.scheduleTrigger',
  typeVersion: 1.2,
  position: [0, 0],
  id: '7cbab17d-c6d0-492f-aadc-f2f8cd3b6994',
  name: 'Schedule Trigger — Every 10 Minutes',
};

const runInitializer = codeNode({
  id: 'ba86f17b-91cb-4374-b25d-d0bd0c1ac785',
  name: 'Initialize Run Metrics',
  file: 'initialize-run.js',
  position: [192, 0],
  mode: 'runOnceForAllItems',
});

const hhBuildSearchRequests = codeNode({
  id: 'f4b44fb8-780c-4a13-85cf-bb3e9b76d028',
  name: 'Build HH Search Requests',
  file: 'hh-search-requests.js',
  position: [416, -640],
  mode: 'runOnceForAllItems',
});
const hhSearch = hhHttpNode({
  id: '278ba465-a3ea-423e-b70c-f41541cd72d2',
  name: 'HH Search Vacancies',
  position: [624, -640],
  url: '={{ $json.hh_search_url }}',
});
const hhParseSearch = codeNode({
  id: 'f7d0faf6-1902-4384-8792-3f4d66ad9f19',
  name: 'Parse HH Search Results',
  file: 'hh-search-response.js',
  position: [832, -640],
  mode: 'runOnceForAllItems',
});
const countHhSearch = codeNode({
  id: '9e2308fe-82f8-449d-8740-f2df6116cab1',
  name: 'Run Metrics — HH Search Items',
  file: 'update-run-metrics.js',
  position: [1040, -640],
  mode: 'runOnceForAllItems',
});
const hhDurableSourceGate = codeNode({
  id: 'f50c7513-b3cf-4545-93e2-99f11278260f',
  name: 'HH Durable Source Gate — New + Due',
  file: 'durable-source-gate.js',
  position: [1248, -640],
  mode: 'runOnceForAllItems',
});
const hhPrefilter = codeNode({
  id: 'a49ed845-185b-47f4-bc5b-b21789cb3b4c',
  name: 'HH Search Result Pre-filter',
  file: 'hh-search-prefilter.js',
  position: [1456, -640],
});
const keepHhPrefilter = filterNode({
  id: '12b855c5-e450-4287-8003-0d84ad95710f',
  name: 'Keep HH PASS + REVIEW',
  position: [1664, -640],
  conditions: [condition('={{ $json.should_fetch_full_vacancy }}', 'boolean', 'true')],
});
const fetchHhVacancy = hhHttpNode({
  id: '1185ad15-9189-4f97-8228-15da3080c966',
  name: 'Fetch HH Vacancy Details',
  position: [1872, -640],
  url: '={{ $json.api_url }}',
  continueOnError: true,
});
const normalizeHhVacancy = codeNode({
  id: 'ad4f2c3c-5483-46e8-a826-1386e8396406',
  name: 'Normalize HH Vacancy',
  file: 'hh-vacancy-normalizer.js',
  position: [2080, -640],
});

const rss = existingNode('Habr RSS Collector');
rss.position = [416, 0];
rss.retryOnFail = true;
rss.maxTries = 2;
rss.waitBetweenTries = 2000;

const countRss = codeNode({
  id: '2baa7e99-a84d-4217-b0fa-29f93dc8d176',
  name: 'Run Metrics — RSS Items',
  file: 'update-run-metrics.js',
  position: [624, 0],
  mode: 'runOnceForAllItems',
});

const unique = existingNode('Habr RSS — Unique GUIDs');
unique.position = [832, 0];
const durableSourceGate = codeNode({
  id: 'd9174cc9-2e82-41bb-aea0-6d9f5ced0301',
  name: 'Durable Source Gate — New + Due',
  file: 'durable-source-gate.js',
  position: [944, -240],
  mode: 'runOnceForAllItems',
});
const prefilter = existingNode('Habr RSS Pre-filter');
prefilter.position = [1040, 0];
delete prefilter.parameters.mode;
prefilter.parameters.jsCode = source('habr-rss-prefilter.js');
const keepPrefilter = existingNode('Keep PASS + REVIEW');
keepPrefilter.position = [1248, 0];

const countPrefilter = codeNode({
  id: '764397f2-e662-47f1-a893-0e88c1e88f92',
  name: 'Run Metrics — Pre-filter PASS',
  file: 'update-run-metrics.js',
  position: [1456, 0],
  mode: 'runOnceForAllItems',
});

const fetchPage = existingNode('Fetch Habr Vacancy Page');
fetchPage.position = [1664, 0];
fetchPage.retryOnFail = true;
fetchPage.maxTries = 2;
fetchPage.waitBetweenTries = 2000;
fetchPage.onError = 'continueRegularOutput';
const normalizer = existingNode('Normalize Habr Vacancy');
normalizer.position = [1872, 0];
normalizer.parameters.jsCode = source('habr-vacancy-normalizer.js');
const hardFilter = existingNode('Hard Filter — Full Vacancy');
hardFilter.position = [2080, 0];
hardFilter.parameters.mode = 'runOnceForEachItem';
hardFilter.parameters.jsCode = source('habr-hard-filter.js');
const persistSourceResult = codeNode({
  id: 'fab83de8-e86e-4c02-a4b4-e6a060ec031f',
  name: 'Persist Source Processing Result',
  file: 'durable-source-result.js',
  position: [2192, -240],
});
const keepHard = existingNode('Keep Hard Filter PASS');
keepHard.position = [2288, 0];

const countHard = codeNode({
  id: 'e2a6b52a-506a-440f-bc40-f037bedb719f',
  name: 'Run Metrics — Hard PASS',
  file: 'update-run-metrics.js',
  position: [2496, 0],
  mode: 'runOnceForAllItems',
});

const levelFilter = existingNode('Level Filter Seniority');
levelFilter.position = [2704, 0];
levelFilter.parameters.mode = 'runOnceForEachItem';
levelFilter.parameters.jsCode = source('habr-level-filter.js');
const keepLevel = existingNode('Keep Level PASS + STRETCH');
keepLevel.position = [2912, 0];

const countLevel = codeNode({
  id: 'a6654519-876d-438b-860f-da9baafc9166',
  name: 'Run Metrics — Level PASS + STRETCH',
  file: 'update-run-metrics.js',
  position: [3120, 0],
  mode: 'runOnceForAllItems',
});

const candidateProfile = existingNode('Candidate Profile');
candidateProfile.position = [3328, 0];
candidateProfile.parameters.mode = 'runOnceForEachItem';
candidateProfile.parameters.jsCode = source('candidate-profile.js');
const durableGate = codeNode({
  id: '401dfbe4-6721-4c94-928f-9e744cc0d8da',
  name: 'Durable Vacancy State Gate',
  file: 'durable-state-gate.js',
  position: [3536, 0],
});

const needsScore = filterNode({
  id: '13c74d08-a1be-4e21-a2c4-0fbe0fb04049',
  name: 'Needs NVIDIA Score',
  position: [3744, -96],
  conditions: [condition('={{ $json.vacancy_state_action }}', 'string', 'equals', 'score')],
});
const needsDeliveryRetry = filterNode({
  id: '7182c742-206a-49fc-b4a1-5e679821078c',
  name: 'Needs Telegram Retry',
  position: [3744, 224],
  conditions: [condition('={{ $json.vacancy_state_action }}', 'string', 'equals', 'deliver')],
});

const rateBudget = codeNode({
  position: [3952, -96],
  id: 'dcda8296-a97f-4bcf-b26a-c9f8c6a1bfc5',
  name: 'NVIDIA Rate Budget — Max 10 Vacancies',
  file: 'nvidia-rate-budget.js',
  mode: 'runOnceForAllItems',
});
const buildRequest = codeNode({
  id: '2d010539-d487-40bc-8d1c-b612064ac3ee',
  name: 'Build NVIDIA Scoring Request',
  file: 'nvidia-scoring-request.js',
  position: [4160, -96],
});

const routePrimary = filterNode({
  id: '04749ff7-bdcb-4a66-8a7b-10768b419a30',
  name: 'Route NVIDIA Primary',
  position: [4368, -208],
  conditions: [
    condition('={{ $json.scorer_request_valid }}', 'boolean', 'true'),
    condition('={{ $json.provider_route }}', 'string', 'equals', 'primary'),
  ],
});
const routeSecondary = filterNode({
  id: '47b97350-ff83-46ae-9e36-1252b9570bdf',
  name: 'Route NVIDIA Secondary',
  position: [4368, 16],
  conditions: [
    condition('={{ $json.scorer_request_valid }}', 'boolean', 'true'),
    condition('={{ $json.provider_route }}', 'string', 'equals', 'secondary'),
  ],
});

const primaryHttp = httpNode({
  id: '302ad479-2670-418d-b27d-62e36d4f17c8',
  name: 'NVIDIA Scorer — Primary',
  position: [4576, -208],
  credentialRef: primaryCredential,
  bodyField: 'nvidia_request_body',
});
const secondaryHttp = httpNode({
  id: '0b18ed7c-cfac-490c-bcf5-b8087f0627c2',
  name: 'NVIDIA Scorer — Secondary',
  position: [5200, 16],
  credentialRef: secondaryCredential,
  bodyField: 'nvidia_request_body',
});
const nanoPrimaryHttp = httpNode({
  id: 'dbfafcb9-694d-49ca-86b8-9af5bc05f395',
  name: 'NVIDIA Scorer — Nano Primary',
  position: [5200, -400],
  credentialRef: primaryCredential,
  bodyField: 'nvidia_fallback_request_body',
});
const nanoSecondaryHttp = httpNode({
  id: '94721aad-3713-433b-ad93-95a2ff8b65c7',
  name: 'NVIDIA Scorer — Nano Secondary',
  position: [5824, 144],
  credentialRef: secondaryCredential,
  bodyField: 'nvidia_fallback_request_body',
});

const parsePrimary = codeNode({
  id: 'f4a49cb5-c47a-45fa-91d2-5f4c02d08f4d',
  name: 'Parse NVIDIA Result — Primary',
  file: 'nvidia-scoring-response.js',
  position: [4784, -208],
});
const parseSecondary = codeNode({
  id: '91e81b01-b9af-4135-b245-d175c70a1115',
  name: 'Parse NVIDIA Result — Secondary',
  file: 'nvidia-scoring-response.js',
  position: [5408, 16],
});
const parseNanoPrimary = codeNode({
  id: '5bc0891f-6577-4c48-8f14-6b985e7fde30',
  name: 'Parse NVIDIA Result — Nano Primary',
  file: 'nvidia-scoring-response.js',
  position: [5408, -400],
});
const parseNanoSecondary = codeNode({
  id: '8bcaeab8-03da-40ce-a54e-aa07e89a0e27',
  name: 'Parse NVIDIA Result — Nano Secondary',
  file: 'nvidia-scoring-response.js',
  position: [6032, 144],
});

function booleanFilter(id, name, position, field) {
  return filterNode({
    id,
    name,
    position,
    conditions: [condition(`={{ $json.${field} }}`, 'boolean', 'true')],
  });
}

const primaryDeliver = booleanFilter('23fbcd4c-465f-44c8-98ad-75998614154d', 'Primary Score Needs Delivery', [4992, -304], 'delivery_required');
const primaryFailover = booleanFilter('1611991d-5416-49c5-bf1d-03baf25e7e82', 'Primary Needs Credential Failover', [4992, -80], 'should_failover_credential');
const primaryModelFallback = booleanFilter('51c17cad-0bba-485a-b282-72f381ee189f', 'Primary Needs Model Fallback', [4992, -496], 'should_model_fallback');
const secondaryDeliver = booleanFilter('bf8b0905-7cda-4ee4-95e0-a614bca47967', 'Secondary Score Needs Delivery', [5616, -80], 'delivery_required');
const secondaryModelFallback = booleanFilter('35052c0c-3045-490f-8ddc-87bc05e979b7', 'Secondary Needs Model Fallback', [5616, 144], 'should_model_fallback');
const nanoPrimaryDeliver = booleanFilter('fc589190-127d-427d-9990-5cd4b15903e6', 'Nano Primary Score Needs Delivery', [5616, -400], 'delivery_required');
const nanoPrimaryFailover = booleanFilter('3b1e238f-0644-4fad-8e80-c14b31e4a4dd', 'Nano Primary Needs Credential Failover', [5616, -272], 'should_failover_credential');
const nanoSecondaryDeliver = booleanFilter('ddcb7d94-b481-4fee-a386-0bf6e90fc82d', 'Nano Secondary Score Needs Delivery', [6240, 144], 'delivery_required');

const buildCard = codeNode({
  id: '19857d77-c4b1-4511-af33-d071fb0acaeb',
  name: 'Build Telegram Vacancy Card',
  file: 'telegram-vacancy-card.js',
  position: [6448, -144],
});
const sendTelegram = {
  parameters: {
    chatId: '={{ $env.MARK_TELEGRAM_CHAT_ID }}',
    text: '={{ $json.telegram_text }}',
    additionalFields: {
      appendAttribution: false,
      disable_web_page_preview: true,
      parse_mode: 'HTML',
    },
  },
  type: 'n8n-nodes-base.telegram',
  typeVersion: 1.2,
  position: [6656, -144],
  id: '54fa7b9a-bad5-4311-955e-e5a2d93f5ab4',
  name: 'Send MARK Vacancy Card',
  ...(existing.get('Send MARK Vacancy Card')?.webhookId
    ? { webhookId: existing.get('Send MARK Vacancy Card').webhookId }
    : {}),
  retryOnFail: true,
  maxTries: 2,
  waitBetweenTries: 3000,
  onError: 'continueRegularOutput',
  credentials: telegramCredential,
};
const persistDelivery = codeNode({
  id: '00fb09bc-a650-48e9-a97d-ad34d8fece9b',
  name: 'Persist Telegram Delivery Result',
  file: 'mark-delivery-result.js',
  position: [6864, -144],
});

const nodes = [
  schedule,
  runInitializer,
  hhBuildSearchRequests,
  hhSearch,
  hhParseSearch,
  countHhSearch,
  hhDurableSourceGate,
  hhPrefilter,
  keepHhPrefilter,
  fetchHhVacancy,
  normalizeHhVacancy,
  rss,
  countRss,
  unique,
  durableSourceGate,
  prefilter,
  keepPrefilter,
  countPrefilter,
  fetchPage,
  normalizer,
  hardFilter,
  persistSourceResult,
  keepHard,
  countHard,
  levelFilter,
  keepLevel,
  countLevel,
  candidateProfile,
  durableGate,
  needsScore,
  needsDeliveryRetry,
  rateBudget,
  buildRequest,
  routePrimary,
  routeSecondary,
  primaryHttp,
  secondaryHttp,
  nanoPrimaryHttp,
  nanoSecondaryHttp,
  parsePrimary,
  parseSecondary,
  parseNanoPrimary,
  parseNanoSecondary,
  primaryDeliver,
  primaryFailover,
  primaryModelFallback,
  secondaryDeliver,
  secondaryModelFallback,
  nanoPrimaryDeliver,
  nanoPrimaryFailover,
  nanoSecondaryDeliver,
  buildCard,
  sendTelegram,
  persistDelivery,
];

const connections = {};
function connectOn(from, outputIndex, ...targets) {
  connections[from] ??= { main: [] };
  connections[from].main[outputIndex] ??= [];
  connections[from].main[outputIndex].push(
    ...targets.map((node) => ({ node, type: 'main', index: 0 })),
  );
}

function connect(from, ...targets) {
  connectOn(from, 0, ...targets);
}

connect(schedule.name, runInitializer.name);
connect(runInitializer.name, rss.name, hhBuildSearchRequests.name);
connect(hhBuildSearchRequests.name, hhSearch.name);
connect(hhSearch.name, hhParseSearch.name);
connect(hhParseSearch.name, countHhSearch.name);
connect(countHhSearch.name, hhDurableSourceGate.name);
connect(hhDurableSourceGate.name, hhPrefilter.name);
connect(hhPrefilter.name, keepHhPrefilter.name);
connect(keepHhPrefilter.name, fetchHhVacancy.name);
connectOn(keepHhPrefilter.name, 1, persistSourceResult.name);
connect(fetchHhVacancy.name, normalizeHhVacancy.name);
connect(normalizeHhVacancy.name, hardFilter.name);
connect(rss.name, countRss.name);
connect(countRss.name, unique.name);
connect(unique.name, durableSourceGate.name);
connect(durableSourceGate.name, prefilter.name);
connect(prefilter.name, keepPrefilter.name);
connect(keepPrefilter.name, countPrefilter.name);
connectOn(keepPrefilter.name, 1, persistSourceResult.name);
connect(countPrefilter.name, fetchPage.name);
connect(fetchPage.name, normalizer.name);
connect(normalizer.name, hardFilter.name);
connect(hardFilter.name, persistSourceResult.name);
connect(persistSourceResult.name, keepHard.name);
connect(keepHard.name, countHard.name);
connect(countHard.name, levelFilter.name);
connect(levelFilter.name, keepLevel.name);
connect(keepLevel.name, countLevel.name);
connect(countLevel.name, candidateProfile.name);
connect(candidateProfile.name, durableGate.name);
connect(durableGate.name, needsScore.name, needsDeliveryRetry.name);
connect(needsScore.name, rateBudget.name);
connect(rateBudget.name, buildRequest.name);
connect(buildRequest.name, routePrimary.name, routeSecondary.name);
connect(routePrimary.name, primaryHttp.name);
connect(routeSecondary.name, secondaryHttp.name);
connect(primaryHttp.name, parsePrimary.name);
connect(parsePrimary.name, primaryDeliver.name, primaryFailover.name, primaryModelFallback.name);
connect(primaryFailover.name, secondaryHttp.name);
connect(primaryModelFallback.name, nanoPrimaryHttp.name);
connect(secondaryHttp.name, parseSecondary.name);
connect(parseSecondary.name, secondaryDeliver.name, secondaryModelFallback.name);
connect(secondaryModelFallback.name, nanoSecondaryHttp.name);
connect(nanoPrimaryHttp.name, parseNanoPrimary.name);
connect(parseNanoPrimary.name, nanoPrimaryDeliver.name, nanoPrimaryFailover.name);
connect(nanoPrimaryFailover.name, nanoSecondaryHttp.name);
connect(nanoSecondaryHttp.name, parseNanoSecondary.name);
connect(parseNanoSecondary.name, nanoSecondaryDeliver.name);
connect(needsDeliveryRetry.name, buildCard.name);
connect(primaryDeliver.name, buildCard.name);
connect(secondaryDeliver.name, buildCard.name);
connect(nanoPrimaryDeliver.name, buildCard.name);
connect(nanoSecondaryDeliver.name, buildCard.name);
connect(buildCard.name, sendTelegram.name);
connect(sendTelegram.name, persistDelivery.name);

const workflow = {
  ...base,
  name: 'AI Job Hunter Mark — Main Pipeline',
  nodes,
  connections,
  staticData: structuredClone(stateSource.staticData ?? base.staticData ?? null),
  pinData: {},
  active: false,
  settings: {
    ...base.settings,
    executionOrder: 'v1',
    timezone: 'Europe/Moscow',
    availableInMCP: false,
  },
  tags: base.tags ?? [],
};

const output = `${JSON.stringify(workflow, null, 2)}\n`;
if (dryRun) {
  process.stdout.write(JSON.stringify({
    id: workflow.id,
    nodes: workflow.nodes.length,
    connections: Object.keys(workflow.connections).length,
    active: workflow.active,
  }, null, 2));
} else {
  fs.writeFileSync(workflowPath, output, 'utf8');
  console.log(`Built ${workflowPath} with ${workflow.nodes.length} nodes`);
}
