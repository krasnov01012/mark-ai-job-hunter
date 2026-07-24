# MARK — AI Job Hunter

MARK — персональный AI Job Hunter MVP и инженерный portfolio project. n8n Community Edition оркестрирует Habr Career RSS, HeadHunter API, детерминированные фильтры, NVIDIA scoring, durable state и Telegram delivery.

## Текущий статус

- 54-node workflow сохранён в `n8n/workflows/ai-job-hunter-main.json` и опубликован в live n8n; nodes/connections совпадают с репозиторным export.
- HeadHunter source подключён через application OAuth2: отдельные bounded searches для remote и Tbilisi, safe server-side exclusion категории `moreThan6`, execution dedupe, pre-filter, full-vacancy fetch и normalizer. Isolated OAuth smoke `144` получил HTTP `200`; production `147` сохранил 25 HH records, а scheduled `149` подтвердил zero-refetch dedupe.
- Любая подтверждённая HH-вакансия с `work_format=REMOTE` проходит географический gate независимо от страны и текстовых ограничений.
- Manual Trigger, `Dev Limit`, legacy smoke nodes и отдельные NVIDIA connectivity nodes удалены из main pipeline.
- Межзапусковый source dedupe не загружает уже обработанные RSS items повторно; ошибки fetch/normalization получают максимум три попытки.
- Candidate Profile `1.2.0` передаёт NVIDIA только компактный `candidate_profile_for_scorer`, а не полный audit-профиль.
- NVIDIA Scorer `1.1.0` использует guided JSON schema, strict parser, deterministic thresholds и active-passive provider fallback с сохранением attempt/failure diagnostics.
- Primary model: `nvidia/nemotron-3-super-120b-a12b`; fast fallback: `nvidia/nemotron-3-nano-30b-a3b`.
- Salary исключена из fit score. Employer salary и Habr `predictedSalary` хранятся и показываются раздельно.
- Telegram card экранирует HTML, показывает score/reasons/gaps и получает Chat ID только из `MARK_TELEGRAM_CHAT_ID`.
- Реальная тестовая vacancy card с пометкой `(тестовая вакансия)` доставлена через credential `Mark Jobhunter`; Telegram API вернул `message_id`.
- Schedule Trigger запускает polling каждые 10 минут; дополнительного time gate, fast retry или внутреннего scheduler lock нет.
- Controlled execution `155` подтвердил credential failover для `401`, `429`, timeout и `503`: 4/4 результата завершились через secondary без ping-pong и без Telegram.
- Scheduled execution `237` подтвердил production HH query `1.1.0`: оба OAuth search вернули HTTP `200`, 52 unique items прошли parse, 4 new items получили full-detail fetch без errors; ни один не прошёл Hard Filter, поэтому NVIDIA/Telegram не вызывались.
- 23 июля 2026 года workflow перенесён на выделенный VPS и запущен как `n8n-mark.service`: основной workflow активен, test workflows выключены, credentials остались только в зашифрованном n8n store.
- Server source smoke получил HH OAuth `200/200`, загрузил 21 full vacancy и передал 4 вакансии в NVIDIA; все 4 provider responses были валидны.
- Контролируемая подходящая вакансия прошла production Hard/Level/Candidate/NVIDIA/Telegram nodes; пользователь подтвердил получение тестовой карточки в Telegram.
- Три automatic server ticks прошли с интервалами 599.568/599.999 секунды, без active overlap, source/provider errors и Telegram-дублей; второй tick пропустил 92 из 93 source items как уже обработанные.
- Подготовлен автономный container deployment: n8n `2.29.10`, PostgreSQL 16, persistent volumes, loopback-only port, health checks, daily backups и safe SQLite → PostgreSQL entity migration. Disposable Docker smoke подтвердил реальный export/import entities, сохранение workflow/static state, health и читаемые PostgreSQL/n8n-data backups.
- Полный локальный regression suite включает workflow и container/security contracts; точный результат последнего запуска зафиксирован в `docs/TESTING.md`.

Live-проверки 16 июля 2026 года:

- execution `92`: контролируемая Junior vacancy прошла Candidate Profile → NVIDIA Super → strict parser; HTTP `200`, score `85`, `APPLY`, `JUNIOR_PLUS`, `salary_used_in_score: false`;
- execution `93`: реальный Habr RSS дал 50 items, source gate пропустил 50 новых, pre-filter оставил 1 для полной загрузки, 49 rejects и полный результат были записаны в source state без ошибок;
- production executions `94–97`: Schedule Trigger и static state сохраняются между runs; повторный RSS snapshot пропустил 49 уже обработанных items и передал только 1 новый;
- executions `116` и `118`: новый fixed schedule выполнил два automatic runs с интервалом 599.962 секунды; execution `117` подтвердил, что ручной Execute больше не блокируется;
- временные test workflows заархивированы; основной workflow опубликован в базе.

Production audit выявил и исправил multi-item mode и branch-safe metrics. После отдельной проверки прежней пары regular/fast-retry расписание упрощено до одного 10-минутного Schedule Trigger: run initializer сохраняет observability, но никогда не блокирует первый или ручной execution.

## Серверный запуск

Основной workflow `RO4i4YmNzEzC2TEV` опубликован на выделенном n8n `2.29.10` и запускается через `systemd` каждые 10 минут. n8n слушает только `127.0.0.1:5678`, production concurrency ограничена одним execution, timezone — `Europe/Moscow`. На сервер перенесены зашифрованные Telegram, HeadHunter OAuth2 и два NVIDIA credentials, Chat ID хранится только в root-owned environment file.

У VPS нет прямого сетевого доступа к Telegram API. Для запуска 23 июля используется временный reverse SSH bridge: Telegram credential обращается только к `127.0.0.1:5680` на сервере, а трафик уходит через локальный Windows relay. Это безопаснее случайного публичного proxy, но пока означает, что для Telegram delivery Windows-компьютер и bridge должны быть включены. HH collection, filtering, NVIDIA scoring и durable retry продолжают работать на VPS независимо; недоставленная карточка остаётся retryable.

Следующий deployment package находится в `deploy/mark/`. Он рассчитан на новый Ubuntu 24.04 VPS в Нидерландах с прямым Telegram egress и не запущен до завершения внешней подготовки сервера. Migration использует `export:entities` / `import:entities`, сохраняет encrypted credentials и bounded state, а до controlled cutover оставляет все workflows unpublished.

## Pipeline

```text
Schedule Trigger (10m)
→ Initialize Run Metrics (always pass)
├─ Habr RSS → in-snapshot dedupe → Habr pre-filter/normalizer
└─ HH OAuth search → ID dedupe → HH pre-filter/normalizer
→ common durable source state
→ source result persistence
→ hard filter
→ level filter
→ candidate profile
→ durable vacancy gate
→ NVIDIA Super primary/secondary
→ Nano model fallback
→ strict parser + compact assessment state
→ Telegram card + delivery state
```

## Быстрый запуск

Для server container deployment использовать [DEPLOYMENT](docs/DEPLOYMENT.md).
Ниже остаётся локальный import flow для разработки.

1. Импортировать workflow:

```powershell
n8n import:workflow --input="n8n\workflows\ai-job-hunter-main.json"
```

2. Убедиться, что в n8n существуют credentials, на которые ссылается workflow:

- Telegram credential;
- NVIDIA primary HTTP Header Auth;
- NVIDIA secondary HTTP Header Auth.
- HeadHunter OAuth2 API credential (`client_credentials`, token URL `https://api.hh.ru/token`).

3. Задать Chat ID вне Git и перезапустить n8n:

```powershell
[Environment]::SetEnvironmentVariable('MARK_TELEGRAM_CHAT_ID', '<chat-id>', 'User')
[Environment]::SetEnvironmentVariable('GENERIC_TIMEZONE', 'Europe/Moscow', 'User')
[Environment]::SetEnvironmentVariable('N8N_BLOCK_ENV_ACCESS_IN_NODE', 'false', 'User')
n8n start
```

`N8N_BLOCK_ENV_ACCESS_IN_NODE=false` нужен n8n 2.x для expression `={{ $env.MARK_TELEGRAM_CHAT_ID }}`. Используйте эту настройку только для выделенного локального MARK instance, где workflow доверенный.

`config/.env.example` содержит только безопасные placeholders. API keys, OAuth client secret/tokens, bot token и Chat ID не должны попадать в workflow export, fixtures, docs или Git.

`.gitignore` закрывает `.env.*`, credential/secret exports, private keys, локальную `.n8n` database, diagnostic JSON/logs и temporary workflow snapshots; `workflow-structure.test.js` отдельно запрещает literal NVIDIA keys, Bearer tokens и HH OAuth client fields внутри отслеживаемого workflow export.

## Проверка

```powershell
Get-ChildItem n8n\code -Filter *.js | ForEach-Object { node --check $_.FullName }
Get-ChildItem tests -Filter *.test.js | Sort-Object Name | ForEach-Object { node $_.FullName }
node scripts\build-main-workflow.mjs --dry-run
n8n audit
```

Подробная матрица: `docs/TESTING.md`.

## Структура

```text
config/                         безопасные model/provider/env contracts
docs/ARCHITECTURE.md            pipeline, state и failure behavior
docs/CURRENT_STATE.md           проверенный live status и один следующий шаг
docs/DEPLOYMENT.md              container migration, cutover, backup и rollback
docs/NVIDIA_MODELS.md           NVIDIA catalog и benchmark
docs/PROVIDER_FALLBACK.md       credential/model fallback contract
docs/ROADMAP.md                 зафиксированный MVP roadmap
docs/TESTING.md                 regression и live evidence
lib/                            reusable deterministic provider logic
n8n/code/                       редактируемые Code node sources
n8n/workflows/                  стабильный workflow export
scripts/                        workflow builder и NVIDIA utilities
tests/                          локальные regression tests
deploy/mark/                     автономный n8n + PostgreSQL container package
```

## Политика поиска

- Salary не является фильтром; отсутствие salary не штрафуется.
- Full remote допустим из любой точки мира; ограничения вакансии по стране не используются как фильтр MARK.
- Hybrid и office допустимы только в Tbilisi, Georgia.
- Unknown/conflicting work format не считается remote автоматически.
- Intern, Junior и Middle допускаются; Middle+ и разумные 2–4 года могут быть `STRETCH`.
- Senior, Lead, Principal, Staff, Head, Architect и подтверждённые 5+ лет обычно отклоняются.
- EDITH и MARK — personal projects, а не commercial production experience.

## Ограничение персонального MVP

Durable state использует bounded `getWorkflowStaticData('global')`. В container deployment n8n database переносится в PostgreSQL, но application-level state contract остаётся workflow static data. Коллекции имеют retention/size limits, а server runtime ограничен одним execution, поэтому это принято как контролируемый компромисс персонального запуска. Для масштабирования state нужно перенести в Data Table или отдельные PostgreSQL tables. Временная зависимость Telegram delivery исчезнет только после фактического cutover на новый VPS и проверки с выключенным Windows bridge.

Подробнее: [CURRENT_STATE](docs/CURRENT_STATE.md), [ARCHITECTURE](docs/ARCHITECTURE.md), [TESTING](docs/TESTING.md) и [ROADMAP](docs/ROADMAP.md).
