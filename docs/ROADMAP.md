# MARK — Roadmap MVP

Актуализировано: 25 июля 2026 года после verified decommission legacy VPS и сохранения migration artifacts.

Обозначения:

- `[x]` — готово и подтверждено;
- `[ ]` — предстоит сделать;
- `DEFERRED` — намеренно отложено и не блокирует MVP.

Roadmap зафиксирован. Идём по порядку, исправляя фактические ошибки по ходу. Микрокоммиты после каждого подпункта не требуются.

## JH-0 — Scope и архитектура `[x]`

- [x] n8n Community Edition выбран оркестратором.
- [x] Habr Career RSS выбран текущим основным источником.
- [x] NVIDIA API выбран AI-провайдером.
- [x] Telegram выбран каналом доставки.
- [x] MVP ограничен одним пользователем.
- [x] Зарплата исключена из hard filtering.
- [x] Full remote проходит format policy из любой точки мира; ограничения вакансии по стране не являются фильтром.
- [x] Hybrid и office разрешены только в Тбилиси, Грузия.
- [x] Docker, RAG, multi-agent, UI и автоотклики исключены из MVP.

## JH-1 — Project Foundation `[x]`

- [x] Установлены Node.js, npm и Git.
- [x] Удалена зависимость среды от Hermes.
- [x] Установлен и запущен n8n `2.29.10`.
- [x] Созданы структура проекта и Git-репозиторий.
- [x] Созданы README, ROADMAP и CURRENT_STATE.
- [x] Выполнен первый smoke workflow.

## JH-2 — Telegram Delivery `[x]`

- [x] Создан Telegram-бот.
- [x] Credential настроен в n8n.
- [x] Получен Chat ID.
- [x] Тестовое сообщение успешно доставлено.
- [x] Финальная карточка вакансии — JH-10.

## JH-3 — Source Collector `[x]`

- [x] Подключён Habr Career RSS.
- [x] Добавлен dedupe внутри текущего RSS-снимка по `guid`.
- [x] Установлен Ultimate pre-filter `4.0.0-ultimate`.
- [x] Pre-filter возвращает `PASS / REVIEW / REJECT`.
- [x] `Keep PASS + REVIEW` пропускает `should_fetch_full_page = true`.
- [x] Полные страницы вакансий загружаются в поле `data`.
- [x] Item linking между RSS и полной страницей сохранён.
- [ ] Межзапусковый durable dedupe — JH-9.
- [ ] Удалить временный `Dev Limit` перед активацией расписания — JH-11.
- [x] HeadHunter приложение одобрено; реализованы OAuth search, execution dedupe, pre-filter и full-vacancy fetch/normalizer.
- [x] HH search разделён на `REMOTE` и Tbilisi (`area=2758`), без salary-параметров; query `1.1.0` отсекает только `moreThan6`.
- [x] Выполнить OAuth recall calibration (`228`): не включать lossy `professional_role`/title-only filters, сохранить `between3And6` для downstream проверки.
- [x] Для HH подтверждённый `work_format=REMOTE` проходит geography gate независимо от страны; contract хранит `remote_geo_eligibility=not_required`.
- [x] Создать OAuth2 credential только в n8n store и подтвердить выдачу application token.
- [x] Выполнить isolated live HH smoke (`144`), сохранить durable state, затем импортировать и опубликовать 53-node main workflow.
- [x] Подтвердить два последовательных multi-source schedule executions и HH durable dedupe (`147`, `149`).

## JH-4 — Normalizer `[x]`

- [x] Реализован Habr SSR parser.
- [x] Добавлен fallback через JSON-LD.
- [x] Добавлен диагностический RSS fallback.
- [x] HTML описания преобразуется в чистый текст.
- [x] Сырой HTML не передаётся дальше.
- [x] Создаётся единый контракт вакансии.
- [x] Нормализуются work format, география, skills и специализации.
- [x] Учитываются отрицания и конфликты удалёнки.
- [x] `salary` работодателя и `predictedSalary` Хабра разделены.
- [x] Отсутствие зарплаты не считается ошибкой.
- [x] Ошибка одного item не валит весь batch.
- [x] Реальный запуск подтвердил `normalization_ok = true`.

Исходники: `n8n/code/habr-vacancy-normalizer.js`, `n8n/code/hh-vacancy-normalizer.js`.

## JH-5 — Hard Filter `[x]`

- [x] Проверяется целостность нормализованной вакансии.
- [x] Архивные и скрытые вакансии отклоняются.
- [x] Full remote допускается из любой точки мира и не требует отдельного country eligibility gate.
- [x] Hybrid/office допускается только в Тбилиси, Грузия.
- [x] Unknown/conflict получает `REVIEW` и не проходит дальше.
- [x] Нерелевантные профессии отклоняются.
- [x] Проверяется наличие substantive AI engineering evidence.
- [x] Зарплата не участвует в решении.
- [x] `Keep Hard Filter PASS` пропускает только `PASS`.
- [x] Проходят 20 локальных сценариев.
- [x] Live-вакансия правильно распознана как Target AI / Tier A.

Исходник: `n8n/code/habr-hard-filter.js`.

## JH-6 — Level Filter `[x]`

- [x] Реализован `Level Filter Seniority`.
- [x] Junior и Intern получают `PASS`.
- [x] Middle получает `PASS`.
- [x] Middle+ и разумные требования 2–4 года получают `STRETCH`.
- [x] Senior, Lead, Principal, Staff, Head и Architect получают `REJECT`.
- [x] Явное требование минимум 5 лет получает `REJECT`.
- [x] Неподтверждённый RSS seniority hint не используется как безусловный reject.
- [x] Неизвестный уровень сохраняется как `STRETCH` для AI-оценки.
- [x] Проходят 20 локальных сценариев.
- [x] Текущая Senior AI Engineer получила `reject_explicit_senior_title`.
- [x] Добавлен `Keep Level PASS + STRETCH` по `should_continue_to_candidate_profile = true`.
- [x] Senior проверен по негативной ветке: `Kept: 0`, `Discarded: 1`.
- [x] Junior проверен по позитивной ветке: `Kept: 1`, `Discarded: 0`.
- [x] Контрольные mock/pinned data удалены перед финальным экспортом.

Исходник: `n8n/code/habr-level-filter.js`.

## JH-7 — Candidate Profile `[x]`

- [x] Создать структурированный версионируемый профиль кандидата.
- [x] Зафиксировать Python, LLM API, NVIDIA API и prompt engineering как user-reported project evidence.
- [x] Зафиксировать архитектурный опыт EDITH как personal project.
- [x] Зафиксировать context/memory/provider abstraction и STT/TTS.
- [x] Честно указать отсутствие коммерческого AI-опыта.
- [x] Зафиксировать пробелы Docker, production RAG, LangGraph, asyncio и CI/CD.
- [x] Не приписывать production experience.
- [x] Добавить proficiency/evidence policy и реалистичные current/stretch/future target roles.
- [x] Добавить восемь repository-verified навыков MARK.
- [x] Создать компактный `candidate_profile_for_scorer` отдельно от полного audit-профиля.
- [x] Убрать score thresholds из Candidate Profile и не приписывать MARK prompt engineering до JH-8.
- [x] Добавить 34 локальные проверки контракта, remote policy, truth policy, размера snapshot и отсутствия очевидных секретов.
- [x] Проверить направление и содержание профиля с пользователем.
- [x] Добавить и проверить live node `Candidate Profile` после `Keep Level PASS + STRETCH`.
- [x] Подтвердить live output Candidate Profile `1.1.0`, затем опубликовать policy revision `1.2.0` с exact repository source и локальной regression matrix.
- [x] Удалить тестовые pinned/mock data и сохранить чистый актуальный workflow export.
- [x] Проверить пустой `pinData`, отсутствие literal secrets и совпадение пяти embedded Code node sources с репозиторными файлами.
- [x] Исключить из стабильного export три отсоединённых legacy smoke/HH nodes с локальными данными.

## JH-8 — NVIDIA Scorer `[x]`

- [x] Синхронизировать публичный NVIDIA Build Catalog и классифицировать все 138 карточек.
- [x] Создать безопасную модульную model-config library с общей JSON Schema и MARK-profile.
- [x] Проверить новый API key прямым вызовом `GET /v1/models`: доступны 118 hosted model IDs, секрет не сохранён.
- [x] Выполнить одинаковый connectivity benchmark shortlist и выбрать primary/fallback.
- [x] Утвердить `nvidia/nemotron-3-super-120b-a12b` как primary, `nvidia/nemotron-3-nano-30b-a3b` как fast fallback и `deepseek-ai/deepseek-v4-flash` как reasoning fallback для scorer calibration.
- [x] Настроить NVIDIA credential без сохранения ключа в workflow или Git.
- [x] Выполнить live n8n connectivity test на утверждённом primary и получить точный JSON при `reasoning_content: null`.
- [x] Спроектировать reusable `active_passive` fallback contract для двух NVIDIA credentials без секретов в Git.
- [x] Реализовать и локально проверить error classifier, bounded attempt budget, credential failover, model fallback и circuit breaker decisions.
- [x] Собрать versioned candidate + vacancy prompt без salary fields.
- [x] Передавать в NVAPI только `candidate_profile_for_scorer`, а не полный audit-профиль.
- [x] Сохранять `candidate_profile_version`, `scorer_prompt_version`, `scorer_version` и parser version.
- [x] Получать и валидировать строгий JSON со score, level, decision, reasons, gaps и summary.
- [x] Использовать решения `APPLY / REVIEW / SKIP` с deterministic thresholds.
- [x] Добавить bounded JSON repair и model fallback для broken contract.
- [x] Подключить явные Super/Nano HTTP Request nodes для primary/secondary credentials.
- [x] Ограничить вход 10 vacancies: worst case 30 provider calls на execution, ниже safety target 35.
- [x] Зафиксировать Telegram threshold `score >= 65`.
- [x] Подтвердить positive live n8n path: HTTP 200, score 85, APPLY, salary excluded.

## JH-9 — Durable State / Duplicate Guard `[x]`

- [x] Хранить source key и `vacancy_key` в bounded workflow state.
- [x] Не загружать и не анализировать обработанный source item повторно.
- [x] Хранить compact AI score и решение.
- [x] Хранить `telegram_sent` отдельно от source seen/scored.
- [x] Переоткрывать source item для незавершённой Telegram delivery.
- [x] Переоткрывать source item после due NVAPI error или stale pending.
- [x] Добавить bounded retention и 23 state-transition regression checks.
- [x] Подтвердить persistence на production Schedule executions: 49 duplicate items skipped, 1 new processed.

## JH-10 — Telegram Vacancy Card `[x]`

- [x] Добавить название, компанию, формат и локацию.
- [x] Показывать employer salary или «не указана».
- [x] Показывать Habr prediction отдельно с пометкой «не оффер».
- [x] Показывать AI score, причины, gaps и summary.
- [x] Добавить ссылку, HTML escaping и bounded message length.
- [x] Добавить bounded Telegram retry и durable delivery result.
- [x] Обновить Telegram credential без секрета в workflow/Git и подтвердить встроенный connection test.
- [x] Подтвердить live delivery новой vacancy card в fresh-process n8n execution; тестовая карточка доставлена и вернула `message_id`.

## JH-11 — Schedule `[x]`

- [x] Заменить Manual Trigger на Schedule Trigger.
- [x] Запускать RSS polling единым Schedule Trigger каждые 10 минут.
- [x] Считать количество vacancies, реально переданных в NVIDIA Scorer.
- [x] Удалить дополнительный 5/30-minute gate и fast retry state.
- [x] Первый production execution после запуска получать только от Schedule Trigger; ручной Execute не блокировать внутренним таймером.
- [x] Обрабатывать только new/due source items через JH-9 state.
- [x] Не создавать tight loop: cadence принадлежит одному 10-minute Schedule Trigger.
- [x] Удалить Manual Trigger и `Dev Limit`.
- [x] Опубликовать workflow в базе и сохранить timezone/Chat ID environment.
- [x] Перезапустить n8n и подтвердить четыре successful Schedule Trigger executions.
- [x] Перезапустить process после multi-item/metrics/tolerance patch и повторить live verification (`103`, `110`, `111`).
- [x] Опубликовать fixed 10-minute schedule и подтвердить automatic `116`/`118` (599.962 s) и неблокируемый manual `117`.

## JH-12 — Reliability Pass `[ ]`

- [x] Добавить ограниченные retry для Habr, NVIDIA и Telegram.
- [x] Добавить durable provider-health state для aliases `nvidia_primary` / `nvidia_secondary`.
- [x] Проверить live credential fallback на контролируемых `401`, `429`, timeout и `5xx` без ping-pong (`155`, 4/4 PASS).
- [ ] Подтвердить фактический quota scope двух NVIDIA keys; не предполагать автоматически, что лимит удвоился.
- [x] Обработать broken HTML и broken JSON с bounded recovery.
- [x] Добавить bounded compact error logging.
- [x] Добавить run summary: RSS, new/skipped GUIDs, filters, AI, provider errors, Telegram.
- [x] Добавить compact fixed-interval scheduler state без второго time gate.
- [x] Проверить несколько последовательных запусков без дублей (`149`, `150`, `151`, `154`, post-restart `156`).
- [ ] Выполнить продолжительный soak test.

## JH-13 — Server Cutover `[x]`

- [x] Подготовить выделенный loopback-only n8n `2.29.10` под `systemd`.
- [x] Ограничить production concurrency одним execution и сохранить timezone `Europe/Moscow`.
- [x] Создать root-only database backup перед импортом.
- [x] Включить ежедневный `backup-mark.timer` и выполнить успешный post-cutover backup.
- [x] Перенести актуальный 54-node workflow с накопленным bounded state.
- [x] Импортировать HH OAuth2, NVIDIA primary/secondary и Telegram credentials только в зашифрованный n8n store.
- [x] Выполнить реальный server HH/NVIDIA source smoke: OAuth `200/200`, 21 full details, 4 valid NVIDIA assessments.
- [x] Выполнить controlled qualifying-vacancy test через production filters/scorer/Telegram; карточка получена пользователем.
- [x] Выключить test workflows и опубликовать только основной workflow `RO4i4YmNzEzC2TEV`.
- [x] Включить `n8n-mark.service` в автозапуск и подтвердить health-check.
- [x] Подтвердить три automatic 10-minute ticks (`175`–`177`) без active overlap, source/provider errors и Telegram duplicates.
- [x] Удалить неиспользованные Tor/WARP packages после failed egress probes и вернуть disk usage к 69%.
- [x] Запустить временный loopback-only reverse SSH bridge для Telegram, не раскрывая bot token.

Historical limitation: Telegram delivery на legacy VPS требовала включённый Windows-компьютер с bridge. Legacy instance удалён; MARK сейчас offline. Новый container target имеет прямой Telegram egress, который нужно подтвердить controlled smoke после deployment.

## JH-14 — Autonomous Container Deployment `[~]`

- [x] Зафиксировать verified n8n image `2.29.10` и PostgreSQL 16.
- [x] Добавить loopback-only Compose, persistent volumes, health checks и restart policies.
- [x] Сохранить production concurrency `1`, timezone `Europe/Moscow` и execution pruning.
- [x] Добавить безопасный `.env.example`; запретить runtime/env/entity/backup files в Git и Docker context.
- [x] Добавить SQLite → PostgreSQL migration через encrypted `export:entities` / `import:entities`.
- [x] После restore принудительно unpublish все workflows и публиковать только `RO4i4YmNzEzC2TEV`.
- [x] Добавить daily PostgreSQL + n8n-data backup и bounded retention.
- [x] Добавить prepare/env/restore/start/verify/publish scripts и rollback contract.
- [x] Добавить CI и container/security regression contract.
- [x] Выполнить disposable SQLite → PostgreSQL entity migration smoke, проверить unpublished workflow/static state, health и backup artifacts.
- [x] Остановить legacy MARK, сохранить verified final database/environment + entity export вне Git и удалить старую установку.
- [x] Выполнить target read-only infrastructure/egress audit и подготовить
  cross-repository integration runbook.
- [x] Закрыть Main Server M1 Release Freeze: согласовать документацию после
  legacy decommission и повторно пройти 27 JS syntax checks, 15 test files /
  967 checks, 7 shell syntax checks, Compose config и repository secret gate.
- [ ] Проверить recovery bundle и согласовать target paths, private HTTPS,
  backup и monitoring contracts.
- [ ] Развернуть package unpublished на target.
- [ ] Подтвердить HH, NVIDIA и controlled Telegram smoke на target.
- [ ] Подтвердить два automatic ticks, bridge-off delivery и reboot recovery.

## Filtering checkpoint после JH-6

- [x] Экспортировать актуальный live workflow.
- [x] Обновить `n8n/workflows/ai-job-hunter-main.json`.
- [x] Убедиться, что в экспорте нет literal secrets; Telegram credential хранится только как штатная ссылка n8n.
- [x] Запустить оба локальных test-файла.
- [x] Просмотреть Git diff.
- [x] Сделать крупный Git checkpoint ingestion + filtering и отправить его в приватный GitHub-репозиторий.

## После MVP

- HeadHunter historical backfill после стабильного live polling.
- Дополнительные источники и исторический backfill.
- Backfill нужен отдельно: повторное чтение RSS не возвращает старые активные вакансии, уже выпавшие из текущего окна.
- Telegram feedback-кнопки.
- Trusted always-on Telegram egress без зависимости от Windows-компьютера.
- Миграция bounded workflow static data в Data Table или отдельные PostgreSQL tables.
- Генерация персонализированного отклика.

## Один текущий шаг

Проверить recovery bundle и согласовать target deployment contract по Main
Server M2–M3; затем выполнить unpublished entity restore и controlled cutover
по `docs/DEPLOYMENT.md`. Quota scope и продолжительный soak остаются отдельными
проверками.
