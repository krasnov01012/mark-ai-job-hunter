# MARK — Current State

Актуализировано: 16 июля 2026 года по фактическому live workflow, результатам n8n, репозиторным исходникам и свежему экспорту workflow.

Актуальный экспорт сохранён в `n8n/workflows/ai-job-hunter-main.json`. Он содержит 15 узлов. Код всех четырёх Code nodes совпадает с репозиторными исходниками; у pre-filter отличается только отсутствующий в экспорте завершающий перевод строки.

## Текущая стадия

```text
JH-0 — JH-6: DONE
JH-7: NEXT
JH-8 — JH-12: PENDING
```

Filtering checkpoint функционально завершён. Следующий этап — JH-7 Candidate Profile.

## Подтверждённая среда

- Windows.
- Node.js `24.18.0`.
- npm `11.16.0`.
- Git `2.55.0.windows.2`.
- n8n Community Edition `2.29.10`.
- Локальный редактор: `http://localhost:5678`.
- Telegram credential настроен; smoke message доставлен.

## Фактический live workflow

```text
Manual Trigger
→ Habr RSS Collector
→ Habr RSS — Unique GUIDs
→ Habr RSS Pre-filter
→ Keep PASS + REVIEW
→ Dev Limit
→ Fetch Habr Vacancy Page
→ Normalize Habr Vacancy
→ Hard Filter — Full Vacancy
→ Keep Hard Filter PASS
→ Level Filter Seniority
→ Keep Level PASS + STRETCH
→ [NEXT: Candidate Profile]
```

## Подтверждённые результаты

### Source ingestion

- Habr RSS отдаёт текущий снимок вакансий.
- Внутри одного снимка удаляются повторные `guid`.
- Pre-filter `4.0.0-ultimate` возвращает все items с `PASS / REVIEW / REJECT`.
- Полные страницы загружаются только для `PASS + REVIEW`.
- HTML ответа находится в поле `data`.

### Normalization

- Habr SSR извлекается из полной страницы.
- Есть fallback через JSON-LD.
- Создаётся компактный контракт без сырого HTML.
- Фактический тест вернул `normalization_ok: true`.
- Зарплата работодателя и прогноз Хабра разделены.

### Hard Filter

- Формат/география проверяются по строгой политике remote/Tbilisi.
- Role gate распознал текущую вакансию как `target`, Tier A, AI Engineer.
- `Keep Hard Filter PASS` успешно пропустил текущий item.
- Локальная матрица: 17/17 сценариев.

### Level Filter

- Текущая вакансия распознана как `senior` с высокой уверенностью.
- Решение: `REJECT`.
- Код: `reject_explicit_senior_title`.
- `should_continue_to_candidate_profile: false`.
- `Keep Level PASS + STRETCH` настроен как Boolean `should_continue_to_candidate_profile is true`.
- Негативный live-маршрут Senior подтверждён: `Kept: 0`, `Discarded: 1`.
- Позитивный контрольный маршрут Junior подтверждён: `PASS`, `Kept: 1`, `Discarded: 0`.
- Контрольные mock/pinned data удалены; свежий экспорт содержит пустой `pinData`.
- Локальная матрица: 20/20 сценариев.

## Исходники Code nodes

```text
n8n/code/habr-rss-prefilter.js
n8n/code/habr-vacancy-normalizer.js
n8n/code/habr-hard-filter.js
n8n/code/habr-level-filter.js
```

Правило синхронизации:

```text
репозиторный JS
→ одноимённый Code node n8n
→ полный запуск workflow
→ экспорт workflow JSON
```

## Автоматические проверки

```text
node tests/habr-hard-filter.test.js
node tests/habr-level-filter.test.js
```

Текущий результат:

```text
PASS: 17 hard-filter scenarios
PASS: 20 level-filter scenarios
```

## Зафиксированная поисковая политика

- Full remote проходит format policy независимо от страны и города офиса; для международных источников отдельно проверяется доступность работы из Грузии (`remote` не всегда означает `worldwide`).
- Hybrid подходит только в Тбилиси, Грузия.
- Office подходит только в Тбилиси, Грузия.
- Unknown/conflicting format не проходит автоматически.
- Зарплата не участвует в фильтрации.
- Отсутствие зарплаты не является штрафом.
- `salary` и `predictedSalary` не смешиваются.
- Junior и Middle допускаются.
- Middle+ и требования 2–4 года допускаются как stretch.
- Явные Senior/Lead/Principal/Staff/Head/Architect отклоняются.
- Явное требование минимум 5 лет отклоняется.
- Seniority не определяется только по случайному упоминанию senior в описании.

## Политика пустого запуска RSS

Цель пользователя: если после обновления RSS ни одна вакансия не дошла до AI-оценки, MARK должен быстрее проверить появление новых вакансий.

Безопасная реализация для JH-11/JH-12:

```text
обычный запуск
→ ai_candidates_count > 0
→ следующий запуск через 30 минут

обычный запуск
→ ai_candidates_count = 0
→ один fast retry через 5 минут

fast retry
→ ai_candidates_count = 0
→ возврат к интервалу 30 минут
```

Обязательные ограничения:

- немедленный повтор без задержки запрещён;
- одновременно может существовать только один fast retry;
- повтор обрабатывает только новые `guid` через durable state JH-9;
- хранится `empty_run_streak` и время последнего ускоренного повтора;
- пустой результат из-за API/error не считается обычным empty run и обрабатывается Reliability policy;
- повторное чтение RSS не является backfill и не возвращает вакансии, уже выпавшие из RSS-окна.

Причина: без этих ограничений неизменившийся RSS-снимок создаст бесконечный цикл запросов и повторной обработки.

## Dedupe: текущее ограничение

`Habr RSS — Unique GUIDs` удаляет повторы только внутри текущего входа. При следующем execution те же вакансии пока могут обрабатываться снова.

Межзапусковый durable state с `vacancy_key`, AI score и `telegram_sent` будет реализован в JH-9.

Adaptive fast retry нельзя включать раньше JH-9: без межзапускового state он будет повторно обрабатывать тот же RSS-снимок.

## Временные и отложенные элементы

- `Dev Limit` остаётся только для безопасной разработки и будет удалён перед Schedule.
- Workflow пока использует Manual Trigger и не активирован.
- HH API отложен до одобрения приложения.
- В экспортированном JSON остаются отсоединённые от main pipeline legacy smoke/HH nodes (`Edit Fields`, `Send a text message`, `HTTP Request`); они не выполняются из текущего Manual Trigger.
- Docker, RAG, multi-agent, UI и автоотклики не входят в MVP.

## Расхождения и статус

| Расхождение | Статус |
|---|---|
| README называл Level Filter только подготовленным | Исправлено |
| ROADMAP не отражал live-проверку Senior | Исправлено |
| CURRENT_STATE не содержал Level Filter в графе | Исправлено |
| Экспорт workflow отставал от live workflow | Исправлено: свежий экспорт сохранён 16 июля 2026 года |
| Нет Filter после Level Filter | Исправлено и проверено по обоим маршрутам |
| Контрольные Junior mock/pinned data могли влиять на запуск | Исправлено: удалены, `pinData` пуст |
| Нет межзапускового durable dedupe | Запланировано в JH-9 |

## Один следующий шаг

Реализовать JH-7 Candidate Profile как отдельный структурированный и версионируемый контракт без секретов и без выдуманного production-опыта.

```text
Candidate Profile
```

Минимальный результат этапа:

- целевые роли и приоритеты;
- подтверждённые навыки и проекты EDITH/MARK;
- явное отсутствие коммерческого AI-опыта;
- пробелы Docker, production RAG/LangGraph, asyncio и CI/CD;
- стабильное поле/объект, который затем получит NVIDIA Scorer.
```

После проверки контракта JH-7 следующим этапом будет JH-8 NVIDIA Scorer.

## Рабочие правила

- Не менять порядок roadmap без явного решения пользователя.
- Не делать микрокоммиты.
- Не хранить credentials и API-ключи в Git.
- Сначала менять репозиторный JS, затем синхронизировать n8n.
- Перед крупным commit проверять экспорт workflow и запускать тесты.
