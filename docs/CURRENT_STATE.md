# MARK — Current State

Актуализировано: 26 июля 2026 года после M12/M13 production acceptance и
portfolio release gate. Repository release проверен локально; policy revision
`1.2.0/1.3.0/1.4.0` ещё не развёрнут на private target.

## Результат текущего checkpoint

```text
JH-0 — JH-8: DONE
JH-9: IMPLEMENTED + PRODUCTION PERSISTENCE VERIFIED
JH-10: DONE + LIVE TELEGRAM DELIVERY VERIFIED
JH-11: DONE + PRODUCTION VERIFIED
JH-12: CONTROLLED FAILOVER VERIFIED; QUOTA SCOPE + SOAK REMAIN
HH API: OAUTH + PRODUCTION POLLING + DURABLE DEDUPE VERIFIED
SERVER STATUS: LEGACY VPS REMOVED; TARGET RUNTIME HEALTHY + MAIN PUBLISHED
CONTAINER DEPLOYMENT: TARGET POSTGRESQL RESTORE + BACKUP VERIFIED
TARGET PREFLIGHT: INFRASTRUCTURE + DIRECT EGRESS + DEPLOYMENT CONTRACT PASSED
RELEASE FREEZE M1: PASSED; 27 JS + 15 TEST FILES / 967 CHECKS + 7 SH + COMPOSE
RECOVERY M2: RECONSTRUCTED BUNDLE VERIFIED BY CLEAN POSTGRESQL IMPORT/DECRYPT
DEPLOYMENT CONTRACT M3: EXTERNAL PATHS + HARDENED BACKUP VERIFIED
PRIVATE HTTPS M4: COMPLETE; CERTIFICATE VALID; SERVE TAILNET-ONLY
TARGET PREFLIGHT M5: COMPLETE; XRAY DISABLED; ROOT PASSWORD RISK ACCEPTED
STAGED PACKAGE M6: EXACT CODE + IMAGES ON TARGET; CONTAINERS NOT CREATED
SECRETS/MIGRATION M7: STAGED + VERIFIED; TRANSFER COPIES REMOVED
RESTORE M8: COMPLETE; 1228 ENTITIES; 3 WORKFLOWS UNPUBLISHED; 4/4 CREDENTIALS
CANDIDATE PROFILE M8.5: VERSION 1.3.0 DEPLOYED; STATE/REFERENCES PRESERVED
PRIVATE UI/SECURITY M9: OWNER + HTTPS/COOKIE/ORIGINS + ISOLATION VERIFIED
TARGET M10: HH + NVIDIA + TELEGRAM + RESTART PASSED; OWNER CHAT CONFIRMATION PENDING
M11 PARTIAL: LOCAL PROBES + RESTIC/RCLONE + DISABLED OFFSITE SKELETON INSTALLED
M12/M13: MAIN PUBLISHED; AUTOMATIC TICKS + CONTAINER/SERVER RESTART PASSED
PORTFOLIO RELEASE: 28 JS + 16 TEST FILES / 1109 CHECKS; CLEAN PUBLIC EXPORT
REPOSITORY POLICY: HH NORMALIZER 1.2.0 + HARD FILTER 1.3.0 + PROFILE 1.4.0
```

Для нового Ubuntu 24.04 VPS в Нидерландах подготовлен `deploy/mark/`:
официальный n8n `2.29.10`, PostgreSQL 16, persistent volumes, loopback-only
`5678`, health checks, restart policies, execution pruning, daily database +
n8n-data backups и безопасный entity migration. Target server имеет прямой
Telegram/NVIDIA/HH egress и достаточные ресурсы; read-only infrastructure audit
пройден. Code-only container package уже staged на target, а private
env/migration/backup paths согласованы с Main Server M3. Для M4 выбран
Tailscale Serve `*.ts.net`: после owner continuation HTTPS Certificates
включены, route направлен только на `127.0.0.1:5678`, Funnel off. Windows без
Tailscale получил timeout; iPhone открыл private URL без TLS warning, а
Tailscale Admin подтвердил certificate valid ещё 3 месяца.

Повторный M5 подтвердил Docker/Tailscale/UFW/fail2ban, свободные MARK/PostgreSQL
порты, registries, direct provider egress и рабочую Hostkey Native Console.
Одновременно обнаружен ранее не документированный `xray` VLESS/REALITY listener
на публичном `0.0.0.0:443`; root password не ротировался после 23 июля.
По последнему решению владельца `xray` сохранён в root-only rollback и
отключён: inactive/disabled, UFW public `443` removed, wildcard listener absent.
Root rotation отклонена владельцем; password не используется automation,
residual risk документирован. Exact `98c549b` release archive проверен
локально и на target: 105 archive entries, 84 deployed files,
`agentops:agentops`, `.git` absent, forbidden runtime/secret files `0`.
Target Compose и inactive 54-node workflow прошли проверку, оба images pulled.
M7 установил `/etc/mark/mark.env` как `root:root:600` и verified reconstructed
entities как `root:mark:600`. Transfer checksums `3/3`, entity checksum, ZIP,
env contract и Compose прошли без вывода secret values; `READY` присутствует.
Remote/local transfer-копии удалены, исходные recovery directories сохранены.
После owner continuation M8 импортировал 1228 entities с
`truncateTables=true`, создал `RESTORED` и запустил PostgreSQL, n8n и backup.
Все 3 workflows unpublished; main workflow содержит 54 nodes, пустой `pinData`
и 364585-byte `staticData`. Credentials расшифровываются 4/4 и все 4 references
разрешаются. Direct health/Telegram/NVIDIA/HH egress checks прошли. Первая
backup pair имеет manifest, checksums `2/2`; PostgreSQL dump и n8n-data archive
читаемы. Backup container сохраняет `cap_drop: ALL` и получает только
`DAC_READ_SEARCH`, необходимый для чтения root-owned n8n-data mount.

M8.5 обновил Candidate Profile до `1.3.0` доказанными навыками из ARIADNE,
MARK и Main Server. Коммерческий и production-proven опыт остаются `false`.
Импорт собран из target export как credential/state source: state ровно
сохранён, workflows снова принудительно unpublished. Перед изменением созданы
читаемый PostgreSQL dump и root-protected rollback-export; transfer-копии
удалены.

Migration сохраняет users, encrypted credentials, workflow ownership и
накопленный static state через `export:entities` / `import:entities`. Original
entity archive сохранил source checksums, но original source encryption key не
вошёл в final backup и не найден в локальных histories, поэтому этот archive не
используется для target restore.

M9 после owner login подтвердил одного enabled owner с установленным password,
`userManagement.isInstanceOwnerSetUp=true`, secure HTTPS/cookie/private-origin
contract, loopback-only `5678`, отсутствие host `5432`, Funnel, community nodes,
Docker socket, host network и host-root mount. `n8n audit` reviewed:
credential warnings ожидаемы при трёх unpublished workflows; 86 official
Code/HTTP locations соответствуют проверенному repository workflow. Версия
`2.29.10` missing 3 updates; upgrade отложен до отдельного backup/compatibility
gate.

M11 read-only audit подтвердил одну complete local backup pair: manifest
checksum lines, `pg_restore --list` и `tar -tzf` passed, `.partial` files `0`.
Два старых orphan PostgreSQL dump без archive/manifest сохранены и не считаются
complete backups. Retention configured `14` days, но age-based expiry ещё не
наступил. Uptime Kuma healthy/private, однако users/monitors/notifications =
`0/0/0`, а Kuma container не достигает MARK через Tailscale URL. Поэтому
установлены hardened host health/backup timers без Docker socket; оба local
probes passed, push пока not configured. Restic/rclone и disabled offsite
service/timer installed; OAuth config и restic password отсутствуют.

M10 target provider smokes выполнили реальные HH OAuth/search/parse/normalize
и NVIDIA scoring/strict parser. HH вернул 2 bounded normalized items. Telegram
nodes в provider workflows отсутствовали, credential values не выводились.
Временные inactive workflows импортировались, исполнялись по exact ID и
удалялись; before/after осталось 3 unpublished workflows, main static state
сохранился ровно `364585` bytes.

Отдельный 6-node Telegram smoke использовал production `Build Telegram Vacancy
Card`, `Send MARK Vacancy Card` и delivery persistence с одной явно synthetic
vacancy. Execution подтвердил delivery success и message ID без вывода ID или
credential values. Root-only sent marker mode `600` установлен как fail-closed
repeat guard. После n8n-only restart сохранились один owner, owner setup,
3 unpublished workflows, `364585` bytes main state и zero active executions.
Контрольный повтор остановился на marker до import/send. Техническая часть M10
завершена; визуальное подтверждение правильного Telegram chat остаётся owner
gate.

M2 создал отдельный reconstructed recovery bundle: final SQLite предоставил
актуальные workflows/user/project/static state, а 4 credential ID/name/type
точно совпали с локальным decryptable credential store. Credentials были
заменены только в disposable копии final SQLite, после чего новый
`export:entities` и verified recovery key сохранены в protected local storage
вне Git/OneDrive. Clean PostgreSQL import восстановил 3 workflows, main workflow
с 54 nodes/empty pin data/364585-byte static state и расшифровал 4/4
credentials. HH/NVIDIA liveness теперь подтверждён на target; Telegram delivery
остаётся отдельным M10 owner gate.

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

Historical global remote policy patch был опубликован без потери state или
credential references: HH Normalizer `1.1.0`, Hard Filter `1.2.0`, Candidate
Profile `1.2.0`. Он разрешал HH remote без geography evidence и с explicit
Russia-only text. Repository release 26 июля supersedes эту policy:
Normalizer `1.2.0`, Hard Filter `1.3.0` и Candidate Profile `1.4.0` требуют
подтверждение доступности работы из Georgia. Revision проверена локально, но
ещё не импортирована на private target.

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

В текущей repository policy HH `REMOTE` нормализуется в
`remote_geo_eligibility`: `confirmed` проходит, `unknown` получает `REVIEW`,
`restricted` — `REJECT`. Hybrid и office остаются допустимы только в Tbilisi,
Georgia. Salary не входит ни в search query, ни в filtering/scoring.

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

Full local result: 1109 checks.

```text
46  candidate-profile
307 container deployment/security
31  durable-source-state
19  durable-vacancy-state
23  hard-filter
20  level-filter
38  HeadHunter integration
131 NVIDIA model configs
9   NVIDIA global rate budget
57  NVIDIA scorer/parser
44  provider fallback
13  run metrics
17  scheduler gate
17  Telegram card
83  target HH/NVIDIA/Telegram smokes
254 workflow structure/export
```

`node --check` passed for all 28 JavaScript sources under `n8n/code`, `lib` and
`scripts`. Compose config validation and POSIX shell syntax validation also
passed. The 54-node repository export is intentionally import-safe with
`active: false`, empty `pinData` and `staticData=null`; production state is
accepted only from an explicit `--state-source`. Repository tests reject
placeholder HH credentials, OAuth client fields/tokens, literal
Bearer/NVIDIA secrets, Chat ID, email, local user paths and container/runtime
secret material. `.gitignore` and `.dockerignore` also block local `.env.*`,
entity exports, backups, credential exports, private keys, copied `.n8n`
databases, diagnostic JSON/logs and temporary workflow snapshots.

Official `n8n audit` findings:

- target M9 сообщает 86 locations для official risky Code/HTTP nodes; они
  ожидаемы для проверенного workflow и остаются под repository review;
- 4 credentials отмечены unused/recently-unused, потому что все workflows
  намеренно unpublished до M12;
- community node manifest отсутствует;
- target `2.29.10` missing 3 updates. Verified runtime не обновлялся внутри
  cutover; upgrade требует отдельного backup/release-note/compatibility gate.

## Main Server M12 production publication

- active только основной workflow `RO4i4YmNzEzC2TEV`; всего workflows `3`;
- два automatic ticks: sequence `361/362`, интервал ровно `600 s`;
- overlap `0`, source/provider errors `0/0`;
- Telegram send count и durable sent-record delta для acceptance ticks `0/0`,
  поэтому повторной доставки не было;
- bounded state: runs `50`, source items `639`, vacancies `23`,
  serialized size `364454` bytes;
- direct Telegram DNS/egress подтверждён; hosts override, proxy env и reverse
  SSH bridge отсутствуют;
- post-publication backup pair создана и прошла checksums/readability.

При `EXECUTIONS_DATA_SAVE_ON_SUCCESS=none` n8n 2.29 soft-delete’ит успешную
execution metadata без финального retained `success`. Поэтому target acceptance
использует durable sequence/run counters совместно с отсутствием live execution.

M13 container restart также пройден: полный Compose restart восстановил
PostgreSQL/n8n/backup, сохранил единственную main publication и private HTTPS;
automatic sequence `363` завершился с errors `0/0`, Telegram `0`, state
`364454` bytes. Pre/post restart backup pairs читаемы.

M13 server reboot пройден: boot ID изменился; SSH/Docker/Tailscale,
PostgreSQL/n8n/backup/Kuma и private HTTPS восстановились автоматически.
Исходная main publication пережила reboot без ручного publish, sequence `364`
прошла с errors `0/0`, Telegram `0`, state `364403` bytes. Final audit после
cleanup: sequence `365`, workflows `3/1`, live executions `0`, failed units
`0`, latest backup pair читаема; публичным остался только SSH `22`.

Первый acceptance verifier имел false-negative в проверке пустого списка failed
units и его fail-closed trap снял publication уже после доказанного reboot
recovery. Observer исправлен, safe state подтверждён, main republished,
повторная проверка прошла. Это не было отказом runtime/autostart.

## Known unverified production behavior

- quota scope of the two NVIDIA keys;
- prolonged server soak behavior;
- owner visual confirmation of the target Telegram chat;
- live target acceptance of HH Normalizer `1.2.0`, Hard Filter `1.3.0` and
  Candidate Profile `1.4.0`;
- полный restore target из созданной backup pair.
- Uptime Kuma push/alert delivery и encrypted offsite snapshot/restore.

## Один следующий шаг

Выполнить controlled target update policy revision
`HH Normalizer 1.2.0 / Hard Filter 1.3.0 / Candidate Profile 1.4.0` с
pre-change backup, сохранением state/credentials и live positive/negative
verification. Затем вернуться к owner-gated M11/M14 closure.
