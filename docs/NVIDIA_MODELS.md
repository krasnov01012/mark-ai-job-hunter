# NVIDIA Model Library for MARK

Актуальный снимок: 16 июля 2026 года.

## Что было проверено

Публичный NVIDIA Build Catalog содержал ровно 138 карточек на момент снимка. Каждая карточка сохранена и классифицирована в репозитории:

```text
config/models/catalog/nvidia-build-catalog.json
config/models/catalog/nvidia-model-analysis.json
```

Новый NVIDIA API key успешно вызвал `GET https://integrate.api.nvidia.com/v1/models` и получил 118 model IDs. Ключ не сохранялся в репозитории, отчётах или конфигурациях.

138 карточек каталога и 118 hosted IDs — разные множества:

- каталог включает downloadable, partner и specialized endpoints;
- `/v1/models` показывает модели, видимые hosted API;
- наличие ID не гарантирует успешный или быстрый `chat/completions`;
- image, audio, embedding и rerank модели нельзя подключать как обычные chat-модели.

## Классификация всех 138 карточек

Каждая карточка получила одну основную family:

| Family | Количество | Роль для MARK |
|---|---:|---|
| `language_reasoning` | 32 | Текущий scorer-кандидат |
| `multimodal_language` | 13 | Будущее расширение |
| `embedding` | 6 | Только post-MVP retrieval |
| `reranking` | 3 | Только post-MVP retrieval |
| `safety_detection` | 9 | Опциональный guardrail |
| `speech_recognition` | 14 | Не требуется MVP MARK |
| `speech_synthesis` | 3 | Не требуется MVP MARK |
| `document_vision` | 14 | Не требуется MVP MARK |
| `image_generation_editing` | 9 | Не требуется MVP MARK |
| `video_media` | 11 | Не требуется MVP MARK |
| `biology_drug_discovery` | 14 | Не относится к MARK |
| `physical_ai_robotics` | 1 | Не относится к MARK |
| `other_specialized` | 9 | Нужен отдельный контракт |

Классификация детерминированная и воспроизводимая. `catalog_capability_score` отражает только официальные catalog claims и доступность, а не независимо измеренное качество модели.

## Сильнейшие general-purpose модели каталога

По официальным описаниям NVIDIA к наиболее сильным/масштабным моделям для reasoning, agents и coding относятся:

1. `nvidia/nemotron-3-ultra-550b-a55b` — frontier agentic reasoning, planning, coding и tool calling.
2. `z-ai/glm-5.2` — flagship LLM для long-horizon reasoning, coding и agents.
3. `deepseek-ai/deepseek-v4-pro` — крупная MoE reasoning/coding модель с длинным контекстом.
4. `qwen/qwen3.5-397b-a17b` — крупная multimodal agentic модель.
5. `mistralai/mistral-large-3-675b-instruct-2512` — state-of-the-art general-purpose MoE VLM.
6. `moonshotai/kimi-k2.6` — 1T multimodal MoE для long-horizon coding и tool use.
7. `nvidia/nemotron-3-super-120b-a12b` — agentic reasoning/planning модель с 12B active parameters.
8. `mistralai/mistral-medium-3.5-128b` — high-performing text/coding/agentic модель.

Это список по catalog positioning, а не утверждение о лидерстве в независимом benchmark. Самая крупная модель не является лучшим выбором для массовой классификации вакансий: latency и стабильность важнее лишнего reasoning.

## Live benchmark для MARK

Тестовый контракт:

```json
{"status":"ok","task":"mark-model-test"}
```

Три финальных кандидата проверены по три последовательных запуска:

| Модель | HTTP success | Strict JSON contract | Median | P95 | Решение |
|---|---:|---:|---:|---:|---|
| `nvidia/nemotron-3-super-120b-a12b` | 3/3 | 3/3 | 1154 ms | 8408 ms | Primary по решению пользователя |
| `nvidia/nemotron-3-nano-30b-a3b` | 3/3 | 3/3 | 1088 ms | 1153 ms | Fast fallback |
| `deepseek-ai/deepseek-v4-flash` | 3/3 | 3/3 | 3231 ms | 9283 ms | Reasoning fallback |
| `qwen/qwen3.5-122b-a10b` | 2/3 | 1/3 | 2638 ms среди успешных | 18476 ms | Не использовать primary до калибровки |

Дополнительный одиночный прогон:

- `google/gemma-4-31b-it`: HTTP 200, 1119 ms, но не raw JSON;
- `mistralai/mistral-small-4-119b-2603`: HTTP 200, 595 ms, но не raw JSON;
- `mistralai/ministral-14b-instruct-2512`: timeout 60 секунд; ранее n8n также получил timeout 30 и 120 секунд.

## Утверждённый стек MARK

```text
Primary scorer:
nvidia/nemotron-3-super-120b-a12b

Fast fallback:
nvidia/nemotron-3-nano-30b-a3b

Reasoning fallback:
deepseek-ai/deepseek-v4-flash

Quality experiment only:
qwen/qwen3.5-122b-a10b

Disabled regression control:
mistralai/ministral-14b-instruct-2512
```

Primary выбран пользователем после успешного строгого connectivity-теста. Super даёт более высокий запас качества и reasoning-возможностей, а Nano сохраняется как быстрый fallback из-за более стабильной задержки:

- Super: 100% доступность и выполнение строгого JSON-контракта в трёх контрольных запусках;
- Super: 120B total / 12B active и более сильная база для semantic fit;
- Super: заметный latency tail до 8408 ms, поэтому timeout остаётся 120 секунд;
- Nano: быстрый fallback при ошибке или недоступности Super.

Для строгого JSON у Nano обязательно используется:

```json
"chat_template_kwargs": {
  "enable_thinking": false
}
```

Без этого параметра модель по умолчанию начинает reasoning и при маленьком `max_tokens` может вернуть `finish_reason: "length"` вместо итогового JSON. Контрольный hosted API вызов с `enable_thinking: false` вернул HTTP 200, `finish_reason: "stop"`, `reasoning_content: null` и точный JSON за 1107 ms. `reasoning_budget: 0` не является корректной заменой: в проверке он смешал reasoning-разметку с двумя JSON-объектами.

Для Super используется его официальный hosted API параметр:

```json
"reasoning_effort": "none"
```

Он отключает reasoning tokens на массовом deterministic scoring и сохранил строгий JSON во всех трёх контрольных запусках. Режимы `low` и `high` можно позже оценить отдельно на сложных пограничных вакансиях, но они не нужны для connectivity test.

Перед окончательным production-выбором JH-8 потребуется scorer evaluation set на реальных вакансиях. Connectivity benchmark не оценивает качество score и рекомендаций.

## Конструктор конфигов

Каждая модель — независимый JSON-блок с единым интерфейсом:

```text
config/models/nvidia/*.json
```

Общие элементы:

- точный provider model ID;
- transport и endpoint;
- input/output modalities;
- catalog evidence;
- допустимые роли в MARK;
- request defaults;
- benchmark timeout;
- lifecycle status.

MARK-profile задаёт порядок и назначение блоков:

```text
config/models/profiles/mark.json
```

Новые конфиги сначала попадают в:

```text
config/models/INBOX.md
```

Нельзя автоматически подставлять chat config в embedding, rerank, image или audio endpoint. Для нового transport добавляется отдельный adapter и тест.

## Команды

Синхронизация публичного каталога и hosted IDs:

```powershell
node scripts/nvidia/sync-catalog.mjs --key-file "C:\path\to\NVIDIA_KEY.txt"
node scripts/nvidia/analyze-catalog.mjs
```

Benchmark всего MARK shortlist:

```powershell
node scripts/nvidia/benchmark-models.mjs --key-file "C:\path\to\NVIDIA_KEY.txt"
```

Повторный benchmark выбранных моделей:

```powershell
node scripts/nvidia/benchmark-models.mjs `
  --key-file "C:\path\to\NVIDIA_KEY.txt" `
  --models nemotron-3-super-120b-a12b,nemotron-3-nano-30b-a3b `
  --runs 3
```

Benchmark-отчёт сохраняется в `reports/nvidia/benchmark-latest.json` и исключён из Git как временный machine/time-specific артефакт.

## Альтернативные проверки

1. `/v1/models` — показывает видимость model ID для ключа, но не проверяет inference.
2. NVIDIA Build Playground — удобен для ручного prompt comparison, но не измеряет воспроизводимость MARK-контракта.
3. Прямой PowerShell/cURL запрос — годится для минимальной диагностики вне n8n.
4. Локальный benchmark runner — сравнивает несколько model blocks одинаковым запросом и измеряет стабильность.
5. n8n HTTP Request — обязательная финальная интеграционная проверка credential, timeout и JSON parser.
6. Scorer evaluation set — обязательная проверка качества на размеченных вакансиях перед утверждением prompt/model pair.

## Безопасность

- API key не хранится в Git.
- Model config не содержит credential values.
- Скрипты читают ключ из `NVIDIA_API_KEY` или `--key-file` только во время процесса.
- Ошибки benchmark не выводят request headers.
- В n8n ключ должен находиться только в credential `NVIDIA API`.
