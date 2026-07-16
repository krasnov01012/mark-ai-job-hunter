# MARK — Roadmap MVP

Актуализировано: 16 июля 2026 года по фактическому live workflow и репозиторным исходникам.

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
- [x] Full remote проходит format policy независимо от офиса; международные ограничения доступности из Грузии проверяются отдельно.
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
- [ ] Финальная карточка вакансии — JH-10.

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
- DEFERRED: HeadHunter API отложен из-за `403` до одобрения приложения.

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

Исходник: `n8n/code/habr-vacancy-normalizer.js`.

## JH-5 — Hard Filter `[x]`

- [x] Проверяется целостность нормализованной вакансии.
- [x] Архивные и скрытые вакансии отклоняются.
- [x] Full remote допускается независимо от офиса; для будущих международных источников требуется отдельная проверка eligibility из Грузии.
- [x] Hybrid/office допускается только в Тбилиси, Грузия.
- [x] Unknown/conflict получает `REVIEW` и не проходит дальше.
- [x] Нерелевантные профессии отклоняются.
- [x] Проверяется наличие substantive AI engineering evidence.
- [x] Зарплата не участвует в решении.
- [x] `Keep Hard Filter PASS` пропускает только `PASS`.
- [x] Проходят 17 локальных сценариев.
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

## JH-7 — Candidate Profile `[ ]`

- [ ] Создать структурированный правдивый профиль кандидата.
- [ ] Зафиксировать Python, LLM API, NVIDIA API и prompt engineering.
- [ ] Зафиксировать архитектурный опыт EDITH.
- [ ] Зафиксировать context/memory/provider abstraction и STT/TTS.
- [ ] Честно указать отсутствие коммерческого AI-опыта.
- [ ] Зафиксировать пробелы Docker, production RAG, LangGraph, asyncio и CI/CD.
- [ ] Не приписывать production experience.

## JH-8 — NVIDIA Scorer `[ ]`

- [ ] Настроить NVIDIA credential.
- [ ] Выполнить connectivity test.
- [ ] Собрать candidate + vacancy prompt.
- [ ] Получать строгий JSON со score, level, decision, reasons, gaps и summary.
- [ ] Использовать решения `APPLY / REVIEW / SKIP`.
- [ ] Добавить broken JSON recovery и один ограниченный retry.
- [ ] Ориентировочный Telegram threshold: `score >= 65`.

## JH-9 — Durable State / Duplicate Guard `[ ]`

- [ ] Хранить `vacancy_key` между executions.
- [ ] Не анализировать одну вакансию повторно.
- [ ] Хранить AI score и решение.
- [ ] Хранить `telegram_sent` отдельно от `seen`.
- [ ] Повторять незавершённую доставку после ошибки Telegram.
- [ ] Не терять вакансию после ошибки NVAPI.

## JH-10 — Telegram Vacancy Card `[ ]`

- [ ] Добавить название, компанию, формат и локацию.
- [ ] Показывать зарплату или «не указана».
- [ ] Не выдавать predicted salary за вилку работодателя.
- [ ] Показывать AI score, причины и gaps.
- [ ] Добавить ссылку и безопасное escaping сообщения.

## JH-11 — Schedule `[ ]`

- [ ] Заменить Manual Trigger на Schedule Trigger.
- [ ] Запускать RSS polling каждые 30 минут.
- [ ] Считать количество вакансий, реально переданных в NVIDIA Scorer за execution.
- [ ] Если `ai_candidates_count = 0`, выполнить один ускоренный повтор RSS через 5 минут.
- [ ] Если ускоренный повтор тоже пустой, вернуться к обычному интервалу 30 минут.
- [ ] Обрабатывать при повторе только новые `guid` через durable state JH-9.
- [ ] Запретить немедленный tight loop и несколько одновременных fast retry.
- [ ] Удалить/отключить `Dev Limit`.
- [ ] Исключить перекрывающиеся executions.
- [ ] Активировать workflow.

## JH-12 — Reliability Pass `[ ]`

- [ ] Добавить ограниченные retry для Habr, NVIDIA и Telegram.
- [ ] Обработать broken HTML и broken JSON.
- [ ] Добавить error logging.
- [ ] Добавить run summary: RSS items, new GUIDs, pre-filter PASS/REVIEW, Hard PASS, Level PASS/STRETCH, AI candidates, Telegram sent.
- [ ] Добавить `empty_run_streak`, `last_fast_retry_at` и защиту от бесконечного refresh.
- [ ] Проверить несколько последовательных запусков без дублей.
- [ ] Выполнить продолжительный soak test.

## Filtering checkpoint после JH-6

- [x] Экспортировать актуальный live workflow.
- [x] Обновить `n8n/workflows/ai-job-hunter-main.json`.
- [x] Убедиться, что в экспорте нет literal secrets; Telegram credential хранится только как штатная ссылка n8n.
- [x] Запустить оба локальных test-файла.
- [x] Просмотреть Git diff.
- [ ] Сделать крупный Git checkpoint ingestion + filtering.

## После MVP

- HeadHunter после одобрения приложения.
- Дополнительные источники и исторический backfill.
- Backfill нужен отдельно: повторное чтение RSS не возвращает старые активные вакансии, уже выпавшие из текущего окна.
- Telegram feedback-кнопки.
- Серверный deployment.
- Генерация персонализированного отклика.

## Один текущий шаг

Реализовать JH-7 Candidate Profile:

```text
структурированный правдивый профиль
→ версионируемый контракт
→ вход для NVIDIA Scorer
```
