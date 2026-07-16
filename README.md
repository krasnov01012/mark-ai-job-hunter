# MARK — AI Job Hunter

MARK — локальный MVP для автоматического поиска вакансий в AI Engineering. Оркестрация выполняется в n8n Community Edition, первичный источник — Habr Career RSS, AI-оценка будет выполняться через NVIDIA API, доставка — в Telegram.

## Текущий статус

- Локальный n8n установлен и работает.
- Telegram smoke test пройден.
- Habr RSS подключён, страницы вакансий загружаются.
- Ultimate pre-filter `4.0.0-ultimate` установлен в workflow и сохранён в репозитории.
- Ранний dedupe внутри RSS-снимка и `Filter — Keep PASS + REVIEW` работают.
- Habr Normalizer `1.0.0` реализован и подтверждён через `normalization_ok: true`.
- Hard Filter `1.0.0` установлен; итоговый Filter пропускает только `PASS`.
- Level Filter `1.0.0` и `Keep Level PASS + STRETCH` установлены; проверены негативный Senior-маршрут и позитивный Junior-маршрут, локально проходят 20 сценариев.
- Актуальный workflow экспортирован в репозиторий; все четыре Code node совпадают с исходниками в `n8n/code/`.
- Актуальный экспорт содержит 15 узлов и не содержит pinned/mock data или literal secrets.
- Текущий шаг: JH-7 — создать структурированный правдивый Candidate Profile как вход для NVIDIA Scorer.

Подробности: [текущее состояние](docs/CURRENT_STATE.md) и [roadmap](docs/ROADMAP.md).

## Структура репозитория

```text
config/                         шаблоны конфигурации без секретов
docs/CURRENT_STATE.md           фактическое состояние и точка продолжения
docs/ROADMAP.md                 зафиксированный план MVP
n8n/code/                       исходники для n8n Code nodes
n8n/workflows/                  экспортированные workflow
```

Основные файлы:

```text
n8n/code/habr-rss-prefilter.js
n8n/code/habr-vacancy-normalizer.js
n8n/code/habr-hard-filter.js
n8n/code/habr-level-filter.js
n8n/workflows/ai-job-hunter-main.json
tests/habr-hard-filter.test.js
tests/habr-level-filter.test.js
```

## Правило синхронизации n8n

Файлы в `n8n/code/` — редактируемые исходники Code nodes. После изменения код нужно синхронизировать с одноимённым узлом n8n, проверить workflow и заново экспортировать `ai-job-hunter-main.json`. Секреты и API-ключи в Git не сохраняются.

## Политика поиска

- Полностью удалённая работа проходит format policy независимо от офиса, но для международных источников доступность работы из Грузии должна быть подтверждена.
- Гибрид и офис подходят только в Тбилиси, Грузия.
- Зарплата может отсутствовать и не используется как фильтр.
- Если очередной запуск не передал ни одной вакансии в NVIDIA Scorer, разрешён один ускоренный повтор RSS через 5 минут; повторяющийся пустой результат возвращает обычный 30-минутный интервал.
- Немедленный бесконечный refresh запрещён: повторный RSS-снимок обычно идентичен, поэтому нужны durable dedupe и loop guard.
- До готового MVP не добавляются Docker, multi-agent, RAG, собственный UI и автоотклики.

## Крупные Git-checkpoints

1. Source ingestion
2. Filtering
3. AI scoring
4. Full MVP
