# MARK — Current State

Актуализировано: 25 июля 2026 года после verified decommission legacy VPS; target server cutover ещё не выполнен.

## Результат текущего checkpoint

```text
JH-0 — JH-8: DONE
JH-9: IMPLEMENTED + PRODUCTION PERSISTENCE VERIFIED
JH-10: DONE + LIVE TELEGRAM DELIVERY VERIFIED
JH-11: DONE + PRODUCTION VERIFIED
JH-12: CONTROLLED FAILOVER VERIFIED; QUOTA SCOPE + SOAK REMAIN
HH API: OAUTH + PRODUCTION POLLING + DURABLE DEDUPE VERIFIED
SERVER STATUS: LEGACY VPS REMOVED; MARK OFFLINE UNTIL TARGET CUTOVER
CONTAINER DEPLOYMENT: IMPLEMENTED + DISPOSABLE DOCKER MIGRATION VERIFIED; TARGET CUTOVER PENDING
TARGET PREFLIGHT: INFRASTRUCTURE + DIRECT EGRESS PASSED; DEPLOYMENT CONTRACT ALIGNMENT PENDING
RELEASE FREEZE M1: PASSED; 27 JS + 15 TEST FILES / 967 CHECKS + 7 SH + COMPOSE
```

Для нового Ubuntu 24.04 VPS в Нидерландах подготовлен `deploy/mark/`:
официальный n8n `2.29.10`, PostgreSQL 16, persistent volumes, loopback-only
`5678`, health checks, restart policies, execution pruning, daily database +
n8n-data backups и безопасный entity migration. Target server имеет прямой
Telegram/NVIDIA/HH egress и достаточные ресурсы; read-only infrastructure audit
пройден. Container package туда ещё не развёртывался, а target paths, private
HTTPS, backup и monitoring contracts согласуются в Main Server M2–M3.

Migration сохраняет users, encrypted credentials, workflow ownership и
накопленный static state через `export:entities` / `import:entities`. Exact
source `N8N_ENCRYPTION_KEY` передаётся только в ignored server `.env`.
Restore оставляет все workflows unpublished; отдельный script публикует только
`RO4i4YmNzEzC2TEV` после controlled smoke. До publication никакой Schedule
Trigger не работает.

Disposable local Docker smoke поднял source SQLite и чистый target PostgreSQL,
экспортировал и импортировал 85 n8n entities, затем подтвердил workflow
`RO4i4YmNzEzC2TEV` с 54 nodes, `active: false`, пустым `pinData` и сохранённым
static state размером 151,547 bytes. Target health вернул HTTP `200`.
Backup service создал читаемые PostgreSQL custom dump и n8n-data archive.
После проверки только disposable containers, networks, volumes и ignored
runtime artifacts были удалены; другие Docker projects не изменялись.

25 июля legacy MARK был остановлен и disabled. После остановки создан финальный
SQLite + environment backup и entity export; SQLite вернула
`PRAGMA integrity_check=ok`, в database подтверждены 3 workflows и 4 encrypted
credentials. Оба переносимых archive скачаны в ACL-protected local directory
вне repository и OneDrive, их SHA-256 совпали с source.

После сохранения recovery artifacts на legacy VPS удалены `n8n-mark.service`,
`backup-mark.timer/service`, Telegram relay, MARK environment, state, backups,
Unix user/group и выделенный global n8n runtime. Независимая SSH-проверка
вернула `LoadState=not-found`, отсутствие command `n8n`, listener `5678`,
MARK paths, cron и systemd references. Новый нидерландский server проверен
read-only и не изменялся.

## Historical production evidence — legacy VPS

Основной workflow `RO4i4YmNzEzC2TEV` был опубликован на legacy VPS как единственный active workflow. Выделенный `n8n-mark.service` имел автозапуск, слушал только `127.0.0.1:5678`, использовал production concurrency `1`, timezone `Europe/Moscow`, execution pruning и системные memory limits. Перед cutover создавались root-only backups. Четыре credentials хранились только в зашифрованном n8n store. Literal secrets во workflow/export/docs не добавлялись.

Server source smoke прошёл реальный HH/NVIDIA path: два OAuth searches вернули `200/200`, 43 items прошли parse, 27 были new/due, 21 получила full-detail HTTP `200`; Hard Filter дал 4 `PASS`, 1 `REJECT`, 16 `REVIEW`. Четыре кандидата получили валидные primary NVIDIA responses со scores `58`, `25`, `42`, `38`; все корректно завершились `SKIP`, Telegram не вызывался.

Отдельная synthetic vacancy `Junior AI Engineer — MARK CUTOVER TEST`, явно помеченная как несуществующая тестовая вакансия, прошла production Hard Filter, Level Filter, Candidate Profile, NVIDIA и Telegram nodes. Пользователь визуально подтвердил получение карточки в нужном Telegram-чате. Повторная отправка не выполнялась; временные source/controlled smoke workflows оставлены inactive.

Прямой HTTPS-доступ legacy VPS к Telegram API блокировался сетью провайдера. Для cutover использовался временный Windows reverse SSH bridge: server endpoint был доступен только на `127.0.0.1:5680`, bot token оставался в n8n credential, relay его не логировал. Tor и Cloudflare WARP не смогли установить внешний transport в этой сети и были полностью удалены, после cleanup root disk usage снизился с 78% до 69%.

После публикации подтверждены три automatic server ticks. Run `175` стартовал `15:00:33.528Z`: 93 source items, 47 new, 46 skipped, 47 processed, 0 source/provider errors, 4 Hard PASS и 4 валидных NVIDIA scores; все были ниже Telegram threshold. Run `176` стартовал через 599.568 секунды: 93 items, 1 new, 92 skipped, 1 processed, 0 errors, 0 NVIDIA/Telegram. Run `177` стартовал ещё через 599.999 секунды: 96 items, 3 new, 93 skipped, 3 processed, 1 valid NVIDIA score, 0 errors и 0 Telegram. State после третьего tick: 381 bounded source records, 19 vacancy records, 50 run summaries, 244,869 serialized bytes.

На сервере `EXECUTIONS_DATA_SAVE_ON_SUCCESS=none`: успешный execution сразу получает `deletedAt`, а устаревшее поле `status=running` может оставаться в soft-deleted строке до фоновой очистки. Проверка только строк с `deletedAt IS NULL` после третьего run вернула 0 active executions; фактического overlap нет.

На legacy VPS workflow `RO4i4YmNzEzC2TEV` был расширен и опубликован с 54 nodes: Habr и HeadHunter имели отдельные collection/pre-filter/normalizer paths и сходились перед common Hard Filter. Credential `MARK HeadHunter OAuth2` хранился только в n8n; isolated execution `144` подтвердил application OAuth и HH `/vacancies` с HTTP `200`. Published nodes/connections точно совпадали с репозиторным export, а накопленный durable state был сохранён. Текущий repository export имеет пустой `pinData`, `active: false` и не содержит literal credentials, OAuth tokens или Chat ID.

Первый scheduled run `145` выявил несовместимость `URLSearchParams` с sandbox Code node. Query builder переведён на `encodeURIComponent`, покрыт отдельным sandbox test и повторно опубликован. Manual `146` прошёл полный multi-source path, production execution `147` успешно обработал 25 уникальных HH vacancies без source errors, а manual `148` подтвердил межзапусковый HH dedupe: все 25 items остановлены durable gate до повторного detail fetch.

Automatic legacy executions `149`, `150`, `151` и `154` прошли без ошибок и повторного detail fetch. В `149` было 25 HH + 50 Habr source items, `new_guid_count=0`, `source_skipped_count=75`, `source_error_count=0`; per-source metrics показали HH `0 new / 25 skipped` и Habr `0 / 50`. На момент проверки published legacy version содержала 54 nodes / 53 connection roots и Durable Source Gate `1.2.0`.

Isolated execution `155` проверил полный credential-failover path без Telegram: controlled `401`, `429` с `Retry-After: 7`, 400 ms timeout и `503` были классифицированы отдельно, каждый request перешёл с `nvidia_primary` на `nvidia_secondary` и завершился валидным score за две попытки. Финальный результат сохранил исходную причину, оба credential aliases и отсутствие ping-pong. Первые два diagnostic runs также выявили stochastic broken/length JSON у Super; scorer получил NVIDIA `guided_json`, а production graph оставляет bounded contract fallback на Nano.

После controlled restart новая published версия запустилась автоматически как execution `156` и завершилась `success`: 50 Habr + 25 HH inputs, оба durable gate вернули 0 new/due, NVIDIA и Telegram не вызывались. State после run занимает 77,196 serialized bytes: 127 source items, 1 vacancy, 33 bounded run summaries, 0 errors.

Global remote policy patch опубликован и активирован без потери state или credential references. Live export содержит exact repository sources: HH Normalizer `1.1.0`, Hard Filter `1.2.0`, Candidate Profile `1.2.0`. Локальная матрица подтверждает `PASS` для HH remote без geography evidence и с explicit Russia-only text; hybrid/office вне Tbilisi остаются `REJECT`. После restart healthz вернул `ok`, workflow активирован с 54 nodes / 53 connection roots. Реальная новая Russia-only vacancy после этого restart пока не попадалась, поэтому именно такой production item ещё не наблюдался end-to-end.

Изолированная OAuth calibration execution `228` сравнила 14 вариантов HH search без NVIDIA, Telegram и production state. Remote baseline содержал 57/57 items; фильтр допустимых experience buckets оставил 47 и исключил только 10 items категории `moreThan6`. `professional_role=96`, tested role set и `search_field=name` сохранили лишь 35–40% baseline IDs и теряли Mid-Level AI Engineer, Data Scientist, AI Automation Engineer и Prompt Engineer. Поэтому live HH query `1.1.0` теперь отсекает только `moreThan6`; `between3And6`, role taxonomy и full-text retrieval остаются для MARK Pre/Hard/Level Filters. Temporary calibration workflow заархивирован.

Первый scheduled production run после publication — execution `237` — завершился `success`. Оба Build HH Search Requests outputs имели query version `1.1.0`, три repeated experience values (`noExperience`, `between1And3`, `between3And6`), отсутствие `moreThan6` и salary criteria. HH OAuth вернул `200/200`: 52 remote + 1 Tbilisi result, после ID dedupe осталось 52; durable gate пропустил 4 новых items, все четыре detail fetch получили HTTP `200`, normalization/hard-filter завершились без errors. Hard Filter не пропустил ни одной вакансии, поэтому NVIDIA и Telegram не вызывались.

Первый production batch `94–97` выявил multi-item mode, metrics и millisecond-boundary defects. Эти исправления подтверждены executions `103`, `110` и isolated multi-item execution `111`. По решению пользователя 5/30-minute gate затем удалён; fixed 10-minute schedule опубликован, перезапущен и подтверждён executions `116`–`118`.

## Фактический pipeline

Опубликованная ветка HH:

```text
Initialize Run Metrics
→ Build HH Search Requests
→ HH OAuth Search (REMOTE + Tbilisi area 2758; exclude only moreThan6)
→ Parse + execution dedupe
→ HH durable source gate
→ HH search-result pre-filter
   ├─ REJECT → Persist Source Processing Result
   └─ PASS/REVIEW → OAuth full-vacancy fetch
                    → Normalize HH Vacancy
                    → common Hard Filter
```

Для HH подтверждённый `REMOTE` проходит geography gate независимо от страны: отсутствие worldwide/Georgia evidence и явное ограничение РФ больше не дают `REVIEW`/`REJECT`. Hybrid и office остаются допустимы только в Tbilisi, Georgia. Salary не входит ни в search query, ни в filtering/scoring.

Общий live downstream pipeline:

```text
Schedule Trigger — Every 10 Minutes
→ Initialize Run Metrics
→ Habr RSS Collector
→ Run Metrics — RSS Items
→ Habr RSS — Unique GUIDs
→ Durable Source Gate — New + Due
→ Habr RSS Pre-filter
→ Keep PASS + REVIEW
   ├─ Discarded → Persist Source Processing Result
   └─ Kept → Fetch Habr Vacancy Page
            → Normalize Habr Vacancy
            → Hard Filter — Full Vacancy
            → Persist Source Processing Result
            → Keep Hard Filter PASS
            → Level Filter Seniority
            → Keep Level PASS + STRETCH
            → Candidate Profile
            → Durable Vacancy State Gate
               ├─ deliver → Telegram
               └─ score → NVIDIA request/router
                           ├─ Super primary → credential failover/model fallback
                           └─ Super secondary → model fallback
                              → strict parser → Telegram threshold 65
```

## Live evidence

### Fixed 10-minute schedule — executions 116–118

- n8n process запущен в `23:38:15`; первый production execution не стартовал немедленно, а дождался timer tick `23:40:33.055`;
- execution `116`, automatic trigger: `Schedule Trigger` 1 item → `Initialize Run Metrics` 1 → RSS 50 → source gate 0, status `success`;
- execution `117`, manual: тот же path прошёл без внутренней блокировки, status `success`;
- execution `118`, automatic trigger: старт `23:50:33.017`, ровно 599.962 секунды после `116`, status `success`;
- initializer output: `scheduler_version=2.0.0`, `scheduler_mode=fixed_interval`, `schedule_interval_minutes=10`, `run_kind=interval_10m`;
- static source state сохранил 51 record; legacy `pending_fast_retry_at_ms`, `next_regular_run_at_ms` и `lock_until_ms` отсутствуют.

### Production schedule and persistence — executions 94–97

- четыре trigger executions завершились `success`;
- execution `94`: 50 RSS items, 50 new source keys, 49 source results persisted;
- execution `95`: scheduler-only tick;
- execution `96`: повторный RSS snapshot, 49 items skipped by durable state, 1 новый item processed;
- execution `97`: scheduler-only tick;
- workflow static data сохранил 51 source record, 2 run summaries и `empty_run_streak=2`;
- persistence и duplicate guard подтверждены на реальном active workflow.

Production batch выявил, что три legacy Code node не имели explicit `runOnceForEachItem`, а shared metrics зависел от branch order. Исправления: explicit modes и contract-field metric detection. Старый scheduler boundary defect также был проверен, после чего пользователь заменил всю 5/30-minute gate схему на единый 10-minute timer.

### Historical scheduler evidence — executions 103 and 110

- execution `103`, `regular`: 50 RSS items, 49 skipped, 1 stale item recovered, `prefilter_pass=1`, `hard_filter_pass=0`, errors `0`;
- execution `110`, `fast_retry`: trigger пришёл примерно на 70 ms раньше exact boundary, tolerance корректно запустил retry через 5 минут;
- retry: 50 RSS items, `new_guid_count=0`, `source_skipped_count=50`; fetch/NVIDIA/Telegram не вызывались;
- scheduler сохранил `fast_retry_used=true`, `pending_fast_retry_at_ms=0`, `last_fast_retry_at` и вернулся к regular cadence.

Эти executions относятся к удалённой 5/30-minute схеме и не описывают текущий fixed 10-minute schedule.

### Multi-item node modes — execution 111

- два controlled eligible items вошли одним batch;
- Hard Filter вернул 2/2 `PASS`;
- Level Filter вернул `junior` и `intern`, оба `PASS`;
- Candidate Profile обработал 2/2, оба профиля attached, оба `should_continue_to_nvidia_scorer=true`;
- provider и Telegram намеренно не подключались; temporary workflow заархивирован.

### Real Habr path — execution 93

- status: `success`;
- RSS: 50 items;
- durable source gate: 50 new items;
- pre-filter: 1 kept, 49 discarded;
- source finalizer: 49 pre-filter rejects + 1 full-page result;
- full-page fetch/normalizer/hard filter: 1 item;
- hard filter result: `REVIEW` because work format was unknown, therefore NVIDIA and Telegram were not called;
- temporary workflow archived after verification.

### NVIDIA positive path — execution 92

- controlled Junior/remote vacancy;
- Candidate Profile `1.1.0` attached without errors;
- primary credential route selected;
- model `nvidia/nemotron-3-super-120b-a12b`;
- HTTP `200`, strict contract valid, no JSON repair;
- score `85`, level `JUNIOR_PLUS`, decision `APPLY`;
- `salary_used_in_score: false`, `delivery_required: true`;
- temporary workflow archived after verification; Telegram was intentionally excluded from this scorer test.

## Durable state contracts

State root: `mark.workflow_state.v1` in n8n global workflow static data.

- `source_items`: up to 2000 compact records, 60-day retention. States: `processing`, `processed`, `retry`, `failed`. Fetch/normalization budget: 3 attempts.
- `vacancies`: up to 1000 compact records, 120-day retention. Scoring/delivery states remain separate so a Telegram failure does not lose an NVIDIA assessment.
- processed source items reopen only when NVIDIA retry, stale pending recovery, or Telegram retry is due.
- `provider_health`: primary/secondary circuit state without credential values.
- `runs`: latest 50 summaries with RSS, new/skipped GUIDs, filter counts, AI counts, provider errors and Telegram sends.

n8n documents static data as experimental, small-state only, production-trigger only, and potentially unreliable at high frequency. MARK polls slowly, bounds all collections and runs with server concurrency `1`, поэтому сохранение текущего state принято как контролируемый компромисс персонального cutover. Data Table/PostgreSQL остаётся обязательным hardening до более долгой и масштабной эксплуатации.

## NVIDIA scorer and fallback

- request schema: `mark.nvidia_scoring_request.v1`;
- assessment schema: `mark.ai_assessment.v1`;
- profile/prompt/scorer/parser versions persist with each assessment;
- salary fields are omitted from the NVIDIA request;
- strict fields: `score`, `level`, `decision`, `reasons`, `gaps`, `summary`, `salary_used_in_score`;
- NVIDIA `guided_json` constrains every Super/Nano response to the same schema, while the parser still validates every field independently;
- deterministic thresholds: `75+ APPLY`, `65–74 REVIEW`, `<65 SKIP`;
- bounded JSON fence/braces repair;
- primary and secondary credential routes are explicit HTTP Request nodes;
- 401/403/429/timeout/5xx can use credential failover; 404/contract failure can use Nano fallback;
- final assessment preserves `attempt_count`, used aliases and the original fallback reason; Nano-primary credential errors continue to Nano-secondary;
- at most 10 vacancies enter the scorer per execution, so worst-case three attempts stay below the 35 calls/minute safety target.

## Telegram

- Telegram bot token remains only in the n8n credential store; credential `Mark Jobhunter` passed the built-in connection test on 17 July 2026.
- Chat ID is stored in environment as `MARK_TELEGRAM_CHAT_ID`; на legacy VPS environment file принадлежал `root:mark`, имел mode `640`, а его значение не печаталось и не коммитилось.
- n8n 2.x environment access is enabled only for this trusted dedicated MARK instance through `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`; otherwise the Telegram node cannot resolve the Chat ID expression.
- A fresh-process n8n smoke execution sent the exact repository card implementation with the marker `(тестовая вакансия)`; exit code was `0` and Telegram returned `message_id`.
- Server cutover smoke повторно подтвердил полный production Telegram path; получение synthetic vacancy в целевом чате подтверждено пользователем.
- Legacy VPS использовал loopback-only reverse SSH bridge из-за provider block.
  Новый target имеет direct Telegram egress, но отсутствие Windows dependency
  должно быть подтверждено controlled target smoke и reboot recovery.
- HTML is escaped; message length is bounded below Telegram's limit.
- employer salary and Habr prediction are labeled separately.
- delivery becomes `telegram_sent: true` only after node success; failures remain retryable.

## Verification

Full local result: 967 checks.

```text
34  candidate-profile
264 container deployment/security
31  durable-source-state
19  durable-vacancy-state
20  hard-filter
20  level-filter
38  HeadHunter integration
131 NVIDIA model configs
9   NVIDIA global rate budget
57  NVIDIA scorer/parser
44  provider fallback
13  run metrics
17  scheduler gate
17  Telegram card
253 workflow structure/export
```

`node --check` passed for all 27 JavaScript sources under `n8n/code`, `lib` and `scripts`. Compose config validation and POSIX shell syntax validation also passed. The 54-node repository export is intentionally import-safe with `active: false`; the removed source-server version was active at its last verified production checkpoint. Repository tests reject placeholder HH credentials, OAuth client fields/tokens, literal Bearer/NVIDIA secrets, Chat ID, email, local user paths and container/runtime secret material. `.gitignore` and `.dockerignore` also block local `.env.*`, entity exports, backups, credential exports, private keys, copied `.n8n` databases, diagnostic JSON/logs and temporary workflow snapshots.

Official `n8n audit` findings:

- Code/HTTP nodes are reported as official risky nodes by design and were reviewed;
- после publication повторный audit категорий credentials/database/filesystem вернул `No security issues found`;
- instance `2.29.10` has updates `2.29.11` and `2.30.7`; audit did not mark them as security fixes or breaking changes, so the verified runtime was not upgraded during this checkpoint.

## Known unverified production behavior

- quota scope of the two NVIDIA keys;
- prolonged server soak behavior;
- Telegram delivery without the temporary Windows reverse SSH bridge;
- end-to-end delivery of a newly discovered HH remote vacancy with explicit country restriction under Hard Filter `1.2.0`.
- decrypt реальных credentials, provider calls и automatic ticks на target VPS;
- reboot recovery и полный restore target из созданной backup pair.

## Один следующий шаг

Проверить recovery bundle по Main Server M2, затем согласовать target
paths/private HTTPS/backup/monitoring contract по M3 и только после этого
выполнить entity restore по `docs/DEPLOYMENT.md`.
