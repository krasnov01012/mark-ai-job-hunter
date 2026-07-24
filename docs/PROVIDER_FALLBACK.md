# Provider Fallback Contract

Версия: `provider.fallback_policy.v1`.

Этот контракт отделяет две разные задачи:

1. **Credential fallback** — повторить тот же корректный запрос через второй API credential.
2. **Model fallback** — использовать другую модель, когда проблема относится к модели или её ответу.

Смена API key не исправляет неверный payload, отсутствующую модель или сломанный JSON. Поэтому эти маршруты не смешиваются.

## Стратегия

Используется `active_passive`:

```text
NVIDIA API — Primary
→ обычный трафик

NVIDIA API — Secondary
→ только eligible failover
```

Round-robin не используется: он усложняет диагностику, расходует оба ключа постоянно и скрывает деградацию primary.

В репозитории хранятся только aliases:

```text
nvidia_primary
nvidia_secondary
```

Значения ключей существуют только в credential store конкретного orchestrator/runtime.

## Матрица решений

| Событие | Действие | Смена credential |
|---|---|---|
| `2xx` + валидный contract | `SUCCESS` | Нет |
| `401` / `403` | открыть circuit до ручной проверки, перейти на secondary | Да |
| `500` с явным `Missing Authorization` | считать credential/config auth error, а не provider outage | Да |
| `429` | учесть `Retry-After`, охладить credential, использовать healthy secondary | Да, если доступен |
| timeout / network error | один bounded retry с backoff, затем secondary | После retry |
| `408`, timeout/network error, `5xx` | один bounded retry, затем secondary | После retry |
| `409` | один bounded retry, затем остановить как conflict | Нет |
| `400` / `422` | остановить как request/config error | Нет |
| `404` model unavailable | model fallback | Нет |
| `2xx`, но JSON/contract сломан | один repair, затем model fallback | Нет |
| safety refusal | сохранить как semantic result/error policy | Нет |
| исчерпан общий attempt budget | остановить и записать terminal error | Нет |

Два NVIDIA keys могут делить account-level или project-level quota. Поэтому secondary повышает доступность при проблеме конкретного credential, но не считается гарантией удвоенного лимита.

## Attempt budget

На один logical request:

```text
max_total_attempts: 3
max_same_credential_retries: 1
max_credential_failovers: 1
max_response_repairs: 1
max_model_fallbacks: 1
```

Типичный transient-маршрут:

```text
attempt 1: primary
→ timeout
attempt 2: primary after backoff
→ timeout
attempt 3: secondary
→ terminal success/error
```

Возврат с secondary обратно на уже использованный primary в рамках того же request запрещён.

## Circuit breaker state

Для каждого alias хранится только operational state:

```json
{
  "credential_alias": "nvidia_primary",
  "status": "healthy",
  "consecutive_failures": 0,
  "circuit_open_until_ms": 0,
  "requires_manual_reset": false,
  "last_http_status": 200,
  "last_error_class": null,
  "last_success_at": "2026-07-16T00:00:00.000Z",
  "last_failure_at": null,
  "rate_limit_reset_at": null
}
```

Состояния:

- `healthy` — маршрут доступен;
- `degraded` — были transient failures, но threshold ещё не достигнут;
- `open` — временно или до ручного reset не использовать.

`401/403` открывают circuit до ручной проверки credential. `429` использует `Retry-After`, когда header доступен; иначе применяется policy cooldown. Повторные network/`5xx` открывают временный circuit после установленного threshold.

## Универсальный request envelope

Credential value в envelope отсутствует:

```json
{
  "request_id": "uuid",
  "project_id": "mark",
  "operation": "vacancy_score",
  "model_role": "primary_scorer",
  "model_id": "nvidia/nemotron-3-super-120b-a12b",
  "credential_alias": "nvidia_primary",
  "attempt": 1,
  "used_credential_aliases": ["nvidia_primary"],
  "fallback_used": false,
  "fallback_reason": null
}
```

Обязательная диагностическая metadata результата:

```json
{
  "provider": "nvidia",
  "credential_alias": "nvidia_secondary",
  "model_id": "nvidia/nemotron-3-super-120b-a12b",
  "attempt_count": 3,
  "fallback_used": true,
  "fallback_reason": "request_timeout",
  "http_status": 200,
  "latency_ms": 1250,
  "provider_request_id": null
}
```

Authorization header, raw credential object и полный local key path не логируются.

## n8n adapter

n8n credentials привязываются к HTTP Request nodes. Поэтому безопасная схема использует два явных request nodes, а не динамическую подстановку секрета:

```text
Build Provider Request Envelope
→ Select NVIDIA Route
  ├─ primary   → NVIDIA Request — Primary Credential
  └─ secondary → NVIDIA Request — Secondary Credential
→ Classify NVIDIA Result
→ Decide Provider Action
  ├─ SUCCESS
  ├─ Wait → RETRY_SAME_CREDENTIAL
  ├─ FAILOVER_CREDENTIAL
  ├─ REPAIR_RESPONSE
  ├─ MODEL_FALLBACK
  └─ terminal error
→ Persist Provider Health
```

Для обоих HTTP Request nodes:

- отдельный n8n Header Auth credential;
- одинаковый endpoint и body;
- `Include Response Headers and Status: ON`;
- `Never Error: ON` для классификации HTTP status в workflow;
- встроенный `Retry On Fail: OFF`, потому что retry budget контролирует policy;
- network error направляется через error output в тот же classifier;
- timeout задаётся model block, а не бесконечным ожиданием.

MARK хранит `provider_health` в bounded workflow static state: 401/403 требуют manual reset, 429 учитывает `Retry-After`, повторные timeout/5xx переводят alias из `degraded` в временно открытый circuit.

## Reusable files

```text
config/providers/schema/provider-fallback.schema.json
config/providers/nvidia.json
lib/provider-fallback.js
tests/provider-fallback.test.js
```

`lib/provider-fallback.js` не знает о MARK, вакансиях или n8n credentials. Он классифицирует результат и возвращает следующее действие. Поэтому policy можно перенести в другой Node.js/n8n проект без копирования секретов.

## Scope текущего checkpoint

Live MARK adapter встроен и проверен execution `155` на controlled `401`, `429`, timeout и `503`: каждый request использовал `nvidia_primary` один раз, затем `nvidia_secondary`, без возврата к уже использованному alias. Final result сохраняет attempt count, aliases и исходную fallback reason; Nano-primary credential error теперь явно маршрутизируется на Nano-secondary.

Reusable `lib/provider-fallback.js` поддерживает policy-вариант с одним same-credential retry. Текущий n8n MVP adapter намеренно проще: eligible credential failures сразу переходят на secondary, а общий graph budget остаётся максимум три provider calls за счёт bounded credential/model branches. Explicit wait/backoff retry loop в live graph не реализован и не должен описываться как production behavior.

## Источники

- NVIDIA NeMo SDK описывает отдельные классы `401`, `403`, `404`, `422`, `429`, connection errors и `5xx`, а также bounded retries для connection/`408`/`409`/`429`/`5xx`: <https://docs.nvidia.com/nemo/microservices/25.9.0/pysdk/index.html>
- NVIDIA NIM LLM использует OpenAI-compatible inference endpoints: <https://docs.nvidia.com/nim/large-language-models/latest/api-reference.html>
- NVIDIA рекомендует `guided_json` с JSON Schema для надёжного structured output: <https://docs.nvidia.com/nim/large-language-models/latest/structured-generation.html>
- n8n HTTP Request умеет возвращать status/headers, использовать `Never Error` и задавать timeout: <https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/>
