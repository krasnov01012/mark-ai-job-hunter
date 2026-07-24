# MARK — Testing

## Локальный regression suite

```powershell
$sources = @(
  Get-ChildItem n8n\code -Filter *.js -File
  Get-ChildItem lib -Filter *.js -File
  Get-ChildItem scripts -Recurse -File | Where-Object { $_.Extension -in '.js', '.mjs' }
)
$sources | Sort-Object FullName | ForEach-Object { node --check $_.FullName }
Get-ChildItem tests -Filter *.test.js | Sort-Object Name | ForEach-Object { node $_.FullName }
```

Проверенный локальный результат 25 июля 2026 года: 967 checks и 27 JavaScript syntax checks. Дополнительно прошли `docker compose config --quiet`, POSIX shell syntax validation и disposable Docker migration/backup smoke.

| Test | Checks | Покрытие |
|---|---:|---|
| `candidate-profile.test.js` | 34 | truth policy, global remote preference, evidence, compact snapshot, secret absence |
| `container-deployment.test.js` | 264 | Compose isolation/persistence/health, migration scripts, ignored runtime data, CI and repository-wide secret patterns |
| `durable-source-state.test.js` | 31 | Habr/HH namespaces, duplicate/retry/terminal/downstream recovery, per-source aggregation |
| `durable-state.test.js` | 19 | fixed schedule initialization and score/delivery state transitions |
| `habr-hard-filter.test.js` | 20 | global remote policy, Tbilisi-only hybrid/office, role and salary policy |
| `habr-level-filter.test.js` | 20 | Junior/Middle/STRETCH/Senior/5+ years |
| `hh-integration.test.js` | 38 | bounded server-side queries, calibrated experience buckets, recall-sensitive downstream filters, dedupe, normalizer, remote/Tbilisi policy and failures |
| `nvidia-model-configs.test.js` | 131 | model catalog/config contracts |
| `nvidia-rate-budget.test.js` | 9 | global ten-vacancy budget across multiple source branches |
| `nvidia-scorer.test.js` | 57 | request omissions, guided schema, strict parser, 401/429/timeout/503, attempt/fallback diagnostics |
| `provider-fallback.test.js` | 44 | classifier, circuit breaker and bounded attempts |
| `run-metrics.test.js` | 13 | per-source metrics and aggregate stage detection |
| `run-initializer.test.js` | 17 | first/immediate execution, fixed 10m metadata, state migration and empty streak |
| `telegram-card.test.js` | 17 | escaping, salary labels, size and required fields |
| `workflow-structure.test.js` | 253 | 54-node reachability, Nano primary credential failover, non-placeholder HH OAuth references, exact embedded Code, OAuth/Bearer/NVIDIA secret scan |

## Container deployment checkpoint — 25 July 2026

- Compose resolves successfully from the placeholder-only `.env.example`;
- n8n defaults to verified `2.29.10`, PostgreSQL to major version 16;
- n8n binds only to `127.0.0.1:5678`; PostgreSQL has no published port and lives on an internal network;
- persistent PostgreSQL/n8n volumes, health checks, restart policies, concurrency `1`, execution pruning and daily backups are declared;
- entity restore requires a completed-upload marker, imports SQLite entities into PostgreSQL and leaves every workflow unpublished;
- publication script unpublishes all workflows before publishing only `RO4i4YmNzEzC2TEV`;
- `.env`, migration entities, dumps, archives and runtime files are ignored by Git and Docker context;
- long token patterns for NVIDIA, Telegram, HH/OAuth material and private keys are absent from config/deploy/docs/n8n files;
- disposable source n8n exported 85 entities from SQLite, and a clean target imported them into PostgreSQL;
- restored workflow `RO4i4YmNzEzC2TEV` retained 54 nodes, 151,547-byte static state, `active: false` and empty `pinData`;
- target n8n health returned HTTP `200`;
- backup service produced a readable PostgreSQL custom dump and readable n8n-data archive;
- disposable containers, networks, volumes and ignored runtime artifacts were removed after the test; target-server credential decrypt, provider calls, automatic ticks and reboot recovery remain deployment acceptance tests.

## HeadHunter checkpoint — 20 July 2026

- 54-node export builds with two bounded HH search scopes and a common downstream filter path;
- search query contains no salary criteria;
- duplicate HH IDs collapse before durable state;
- explicit Senior+ and confirmed 5+ are rejected before detail fetch;
- HH HTML/detail fields normalize into the common contract;
- confirmed `REMOTE` passes geography regardless of country text; Russia-only and unknown remote geography do not reject the vacancy;
- global NVIDIA admission remains capped at ten vacancies across Habr and HH branches;
- OAuth secret/token values are absent from source, tests and workflow export.

Credential `MARK HeadHunter OAuth2` создан только в n8n store с `client_credentials`, body authentication и token expiry status `403`. Изолированный workflow без NVIDIA/Telegram выполнился как execution `144`: OAuth успешен, HH `/vacancies` ответил HTTP `200`, сообщил `found=43` и вернул 5 items. После smoke workflow архивирован.

Перед NVIDIA reliability publication повторно сохранён live durable state размером 76,177 serialized bytes. После импорта и controlled restart published workflow содержит 54 nodes / 53 connection roots, активен и точно совпадает с repository nodes/connections; state до и после импорта byte-for-byte совпал по JSON representation. Client ID, client secret и tokens отсутствуют в workspace files и export.

### Global remote policy — 20 July 2026

- HH Normalizer `1.1.0` ставит `remote_geo_eligibility=not_required` для подтверждённого `REMOTE`;
- Hard Filter `1.2.0` принимает remote без geography evidence и с explicit Russia-only text;
- Candidate Profile `1.2.0` явно запрещает использовать country restriction remote-вакансии как filter;
- 20 hard-filter scenarios, 35 HH integration checks и 34 candidate-profile checks прошли;
- live export после publication совпал с этими тремя repository sources, сохранил static state и credential references;
- реальная новая Russia-only remote vacancy после publication ещё не наблюдалась end-to-end.

### HH server-side filter calibration — execution 228

Изолированный archived workflow выполнил 14 OAuth search-запросов без durable state, NVIDIA и Telegram. Все ответы имели HTTP `200`; оба baseline полностью помещались на `page=0`.

- remote baseline: 57; допустимые experience buckets: 47; потеря 10/10 только с `experience=moreThan6`;
- Tbilisi baseline: 1; единственная вакансия также была `moreThan6`;
- `professional_role=96`: 35.09% remote baseline IDs;
- tested role set `96/10/79/156`: 38.60%; среди потерь были Mid-Level AI Engineer, Data Scientist, AI Automation Engineer и Prompt Engineer;
- `search_field=name`: 40.35%; терялись вакансии с substantive AI work вне title;
- entry-only experience без `between3And6`: 38.60% и терял Agentic AI Engineer/Middle candidates.

Итог: production query `1.1.0` повторяет `experience` для `noExperience`, `between1And3`, `between3And6`; `professional_role` и `search_field` не сужаются. Calibration workflow заархивирован после execution.

### Execution 237 — production query 1.1.0

- automatic Schedule Trigger, status `success`, no execution error;
- exact query contract: two scopes, version `1.1.0`, three repeated accepted experience buckets, no `moreThan6`, no salary criteria;
- HH search HTTP `200/200`: 52 remote + 1 Tbilisi, 52 unique IDs after overlap dedupe;
- durable source gate: 4 new/due items;
- four detail requests: HTTP `200/200/200/200`;
- normalizer and Hard Filter processed all four without node errors;
- Hard Filter PASS: 0, so NVIDIA and Telegram were not called.

### Execution 155 — controlled NVIDIA credential failover

Изолированный 13-node workflow не содержал Telegram nodes и не передавал credential локальной primary fixture. Четыре controlled responses (`401`, `429` + `Retry-After: 7`, 400 ms timeout, `503`) прошли production request/parser/filter nodes, затем реальный secondary NVIDIA credential. Валидатор выполнил 24 проверки: 4/4 `PASS`, final alias `nvidia_secondary`, `attempt_count=2`, оба aliases сохранены, исходные причины — `authentication_error`, `rate_limit`, `request_timeout`, `provider_transient`.

Diagnostic executions `152` и `153` подтвердили, что route/metadata работают 4/4, и одновременно поймали два stochastic Super contract failures. Поэтому scorer `1.1.0` теперь передаёт NVIDIA `guided_json`; production graph также сохраняет bounded Super → Nano contract fallback. Финальный execution `155` завершился `success` за 3.52 s, все четыре Super responses прошли strict contract.

### Execution 156 — published workflow after restart

Первый automatic run новой 54-node published версии завершился `success` в 1.079 s. Workflow прочитал 50 Habr и 25 HH items; оба durable source gate вернули 0 new/due, поэтому detail fetch, NVIDIA и Telegram не вызывались. Live state после run: 77,196 serialized bytes, 127 source items, 1 vacancy, 33 bounded summaries, 0 errors.

## Live evidence

### Executions 145–148 — HeadHunter production integration

- `145` (scheduled) корректно выявил n8n sandbox error `URLSearchParams is not defined`; query builder переведён на `encodeURIComponent`, а regression suite дополнен n8n-like VM context.
- `146` (manual, 2.418 s) после исправления прошёл search → dedupe → pre-filter → detail fetch → normalizer → common hard filter.
- `147` (scheduled, 1.674 s) завершился `success`: HH search дал 25 unique items, все 25 записаны в durable source state, `source_error_count=0`.
- `148` (manual, 1.32 s) повторно получил те же 25 HH items, но durable gate вернул 0 outputs; detail fetch не повторялся.
- `149` (scheduled, 1.05 s) подтвердил production dedupe: 25 HH + 50 Habr inputs, `new_guid_count=0`, `source_skipped_count=75`, `source_error_count=0`; HH metrics `0 new / 25 skipped`, Habr `0 / 50`.

После `147` дополнительно исправлена per-source агрегация `new_guid_count` / `source_skipped_count`; execution `149` подтвердил её на текущей published версии Durable Source Gate `1.2.0`, сохраняющей 25 HH records.

### Executions 116–118 — fixed ten-minute schedule

n8n process started at `23:38:15`. The first production run waited for the timer and started at `23:40:33.055`; it did not execute immediately on process start. Execution `116` passed one item through `Schedule Trigger — Every 10 Minutes` and `Initialize Run Metrics`, collected 50 RSS items and stopped cleanly after the durable source gate found no new items.

Manual execution `117` passed the same nodes without an internal scheduler lock. The next automatic execution `118` started at `23:50:33.017`, 599.962 seconds after `116`, and completed with the same clean duplicate-only result. Both automatic executions were `success`; initializer output reported fixed interval version `2.0.0` and no legacy 5/30-minute timing fields remained in global state.

### Executions 94–97 — production schedule and persistence

The active Schedule Trigger produced four successful executions. Static state persisted 51 source records and two run summaries. Execution `96` skipped 49 repeated RSS items and processed only one new item, proving inter-execution duplicate protection.

The same batch exposed three defects that single-item tests could not detect: missing per-item modes, branch-order-dependent metrics, and a 56 ms early schedule tick. Regression tests were added before republishing the patch.

### Executions 103 and 110 — historical 5/30-minute scheduler regression

Execution `103` stored correct branch-safe metrics and recovered one stale source item. Execution `110` started as `fast_retry` on the next five-minute tick even though the trigger arrived about 70 ms before the exact stored boundary. It skipped all 50 duplicate GUIDs and stopped at the source gate.

This evidence belongs to the removed scheduler gate. The current design uses one explicit ten-minute Schedule Trigger and an always-pass run initializer.

### Execution 111 — n8n multi-item mode

An archived temporary workflow passed two controlled eligible items through the exact main-workflow Hard Filter, Level Filter and Candidate Profile nodes. Every node returned two outputs; both profiles opened the NVIDIA gate. No provider or Telegram call was included.

### Execution 92 — positive NVIDIA scorer

Controlled input was used only in an archived temporary workflow. It verified the real n8n HTTP credential, Super model, request body, item linking and parser without sending Telegram.

Expected and observed:

```text
HTTP 200
nvidia_result_valid = true
nvidia_error_class = success
model = nvidia/nemotron-3-super-120b-a12b
score = 85
decision = APPLY
salary_used_in_score = false
```

### Execution 93 — real Habr negative path

```text
RSS = 50
source gate = 50 new
pre-filter = 1 kept / 49 discarded
source finalizer = 49 + 1
fetch + normalize + hard filter = 1
hard PASS = 0
status = success
```

This proves that a real unknown work format does not silently become remote and that discarded items are finalized in source state.

## Export verification

```powershell
node scripts\build-main-workflow.mjs
node tests\workflow-structure.test.js
n8n import:workflow --input="n8n\workflows\ai-job-hunter-main.json"
n8n export:workflow --id=RO4i4YmNzEzC2TEV --output="<temporary-path>"
```

Before publication, live and repository structures matched for ID, name, nodes, connections, settings, active state and empty `pinData`.

### Telegram credential — 17 July 2026

Credential `Mark Jobhunter` was updated in the n8n credential store and passed the built-in connection test. The workflow credential reference and owner relation remained unchanged. `MARK_TELEGRAM_CHAT_ID` was present with numeric format and the user timezone was `Europe/Moscow`; no token or Chat ID value was written to the repository. A real vacancy-card delivery was not sent during this configuration check.

### Telegram vacancy-card live delivery — 17 July 2026

An archived one-time workflow used the exact `n8n/code/telegram-vacancy-card.js`, the production Telegram credential and `MARK_TELEGRAM_CHAT_ID`. Its controlled fixture was visibly marked `(тестовая вакансия)`. The fresh-process n8n execution finished with exit code `0`, the returned Telegram payload contained the marker and `message_id`, and no credential or Chat ID value was printed or committed.

The smoke test also exposed the n8n 2.x environment guard before any API success. `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` is now persisted for the dedicated trusted MARK instance so the production Telegram expression can resolve its environment-only Chat ID.

### Server cutover — 23 July 2026

The current 54-node workflow, bounded static state and four encrypted credentials were imported into the dedicated VPS n8n `2.29.10`. The source smoke used the exact production HH and NVIDIA nodes:

- HH OAuth search: HTTP `200/200`;
- 43 parsed items, 27 new/due and 21 successful full-detail responses;
- Hard Filter: 4 `PASS`, 1 `REJECT`, 16 `REVIEW`;
- NVIDIA primary: 4 valid responses, scores `58`, `25`, `42`, `38`;
- all four decisions were `SKIP`, therefore Telegram was correctly not called.

A separate synthetic vacancy, visibly named `Junior AI Engineer — MARK CUTOVER TEST` and marked as not a real employer, passed the production Hard/Level/Candidate/NVIDIA/Telegram path. The user confirmed receipt in the intended Telegram chat. The test was not repeated, and both temporary workflows are inactive.

After main publication, automatic runs `175`–`177` started at `15:00:33.528Z`, `15:10:33.096Z` and `15:20:33.095Z`. The first two intervals were 599.568 and 599.999 seconds. Run `175` processed 47 new items and scored 4; run `176` skipped 92/93 duplicates and processed only one new item; run `177` skipped 93/96 and processed three. Across all three: 0 source errors, 0 provider errors and 0 Telegram duplicates.

The server intentionally uses `EXECUTIONS_DATA_SAVE_ON_SUCCESS=none`. Successful rows are soft-deleted with `deletedAt` while the stale `status=running` field may remain until physical pruning. Querying only `deletedAt IS NULL` after run `177` returned zero active main executions, confirming no overlap.

## Security audit

```powershell
n8n audit
```

Expected findings:

- Code and HTTP Request are official powerful/risky node classes and require source review;
- inactive workflows make their credentials appear unused; after MARK publication categories credentials/database/filesystem returned no issues;
- instance updates may be reported separately from workflow correctness.

Unexpected findings that block publication:

- literal API key, bot token or Chat ID;
- local user path or email in stable export;
- unconnected legacy/test nodes;
- pinned/mock data;
- hidden unbounded retry or unreachable node.

## Legacy VPS decommission — 25 July 2026

- `n8n-mark.service`, backup timer и Telegram relay были stopped/disabled до удаления;
- финальный SQLite backup прошёл `PRAGMA integrity_check=ok` и содержал 3 workflows + 4 encrypted credentials;
- database/environment backup и entity archive скачаны в ACL-protected local storage вне Git/OneDrive, source/local SHA-256 совпали;
- legacy MARK units, environment, state, project/backups, Unix user/group и dedicated global n8n runtime удалены;
- независимое SSH-подключение подтвердило `LoadState=not-found`, отсутствие listener `5678`, command `n8n`, MARK paths, cron и systemd references;
- новый нидерландский server был проверен read-only и не изменялся.

## Main Server M1 Release Freeze — 25 July 2026

- повторно пройдены 27 JavaScript syntax checks;
- все 15 test files завершились успешно: 967 checks;
- 7 deployment shell scripts прошли `bash -n`;
- `docker compose --env-file deploy/mark/.env.example -f deploy/mark/compose.yaml config --quiet` завершился успешно;
- workflow export подтверждён как `RO4i4YmNzEzC2TEV`, 54 nodes, 53 connection roots, `active: false`, пустой `pinData`;
- repository secret contracts подтвердили отсутствие literal OAuth/Bearer/NVIDIA secrets, Telegram bot token/Chat ID, private keys и local user paths;
- `git diff --check`, conflict-marker scan и локальные ссылки изменённой документации прошли.

## Main Server M2 Recovery Reconstruction — 25 July 2026

- original `entities.zip` и final SQLite/environment archive найдены вне
  Git/OneDrive; source checksums совпали `2/2`, оба archive читаются;
- final SQLite повторно дал `integrity=ok`: 3 workflows, 4 credentials,
  1 user/project; main workflow содержит 54 nodes, empty pin data и
  364585-byte static state;
- original source encryption key отсутствует в archive и локальных histories;
  controlled disposable import с другим ключом дал ожидаемый `bad decrypt`;
- credential metadata final/local stores совпала 4/4 по ID/name/type;
- создан protected reconstructed bundle: final workflow/state/users +
  decryptable credential blobs, новый entity export и verified recovery key;
- reconstructed checksums совпали `2/2`, ACL допускает только
  owner/SYSTEM/Administrators, location находится вне Git/OneDrive;
- clean PostgreSQL import восстановил 3 workflows и расшифровал 4/4 credentials;
- disposable containers, networks и temporary directories после проверки
  отсутствуют;
- фактическая работоспособность HH/NVIDIA/Telegram credentials остаётся
  controlled target smoke gate, а original entity archive хранится только как
  immutable evidence.

## Remaining production tests

- deploy target container and verify direct Telegram egress without a Windows bridge;
- long-running soak test and state-size observation.
