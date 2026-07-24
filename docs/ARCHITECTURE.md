# MARK — Architecture

## Цель

MARK использует два source-specific paths: Habr Career RSS и HeadHunter API. n8n Community Edition остаётся orchestrator, а JavaScript в Code nodes — основной implementation language.

## Поток данных

```text
Source
→ source dedupe/pre-filter
→ full-page fetch
→ source normalizer
→ common hard filter
→ level filter
→ candidate profile
→ NVIDIA scorer
→ durable state
→ Telegram
→ scheduling/reliability
```

Source-specific fields заканчиваются нормализованным vacancy contract. Hard/level filters и все последующие nodes работают только с common fields и explainable decisions.

HeadHunter использует application OAuth2 (`client_credentials`). Два search request ограничивают collection: `REMOTE` на `hh.ru` и Tbilisi `area=2758` на `headhunter.ge`. Оба запроса используют один обязательный `HH-User-Agent`, не содержат salary criteria, исключают только заведомо неподходящую HH-категорию `moreThan6` и проходят общий per-run ID dedupe.

### HeadHunter server-side filtering

MARK не выгружает 2000 вакансий. Текущая production collection строит два запроса `page=0&per_page=100&period=1`: максимум 200 raw items до пересечения и ID-dedupe. Число 2000 в HH OpenAPI — предел глубины пагинации одного поиска, а не обязательный размер выгрузки.

На стороне HH применяются однозначные дешёвые ограничения: `text`, `period`, `work_format=REMOTE` для global remote scope, `area=2758` для Tbilisi scope и три допустимые категории `experience=noExperience&experience=between1And3&experience=between3And6`. Это отсекает только `moreThan6`; смешанный диапазон 3–6 остаётся для downstream проверки фактических 5+ лет. API также поддерживает `professional_role`, `employment_form`, `search_field`, `excluded_text` и другие параметры, но они намеренно не заменяют MARK gates:

- `professional_role` — широкая таксономия работодателя и не доказывает substantive AI engineering work;
- `experience=between3And6` объединяет допустимые 3–4 года и обычно отклоняемые подтверждённые 5+, поэтому эта категория не отсекается на HH;
- title/snippet не заменяет full description при поиске Senior/Lead wording, неоднозначного формата и реальных обязанностей;
- salary не передаётся в query согласно permanent policy.

Поэтому HH отвечает за coarse retrieval, search pre-filter экономит detail requests, а common Hard/Level Filter остаётся источником точного explainable решения. Авторизованная calibration execution `228` подтвердила: исключение `moreThan6` убрало 10 из 57 remote results, и все 10 имели именно эту категорию; `professional_role=96`, tested role set и `search_field=name` сохранили только 35–40% baseline IDs, поэтому не включены.

## Основные контракты

| Contract | Version | Назначение |
|---|---:|---|
| Habr pre-filter | `4.0.0-ultimate` | дешёвая RSS-классификация до HTTP fetch |
| HH search query | `1.1.0` | bounded remote + Tbilisi API searches без salary и `moreThan6` |
| HH pre-filter | `1.0.0` | explicit Senior+/off-target reject, ambiguous items remain REVIEW |
| HH normalizer | `1.1.0` | OAuth API response → common vacancy contract |
| Candidate Profile | `mark.candidate_profile.v1` / `1.2.0` | полный проверяемый профиль без credentials/PII |
| Scorer snapshot | `mark.candidate_for_scorer.v1` | компактная часть профиля для NVIDIA |
| NVIDIA request | `mark.nvidia_scoring_request.v1` | versioned prompt + vacancy + snapshot |
| AI assessment | `mark.ai_assessment.v1` | strict score/level/decision/reasons/gaps/summary |
| Workflow state | `mark.workflow_state.v1` | source, vacancy, provider, run и scheduler state |
| Provider fallback | `provider.fallback_policy.v1` | bounded active-passive decisions |

## Детерминированные gates

1. Source pre-filters сохраняют `PASS / REVIEW / REJECT`, reasons, warnings и evidence.
2. Hard Filter применяет work-format/geography/role policy и пропускает только `PASS`.
3. Level Filter отклоняет явные senior+ роли и сохраняет `PASS / STRETCH`.
4. Candidate Profile проверяет truth policy до NVIDIA.
5. Parser проверяет strict AI contract и сам вычисляет итоговый decision по score thresholds.

LLM не решает salary policy, географические hard rules или senior rejection заново.

Для HH подтверждённый `work_format=REMOTE` достаточен для географического `PASS`: MARK не отклоняет remote по стране, включая explicit Russia-only text. `remote_geo_eligibility=not_required` сохраняется в common contract как явный маркер этой политики. Hybrid и office по-прежнему требуют Tbilisi, Georgia.

## State model

### Source state

```text
new → processing → processed
                 ↘ retry → processing
                 ↘ failed (after 3 attempts, retained for audit)
```

`processed` item может открыться повторно только для due NVIDIA/Telegram recovery. Это предотвращает ежедневный full-page fetch одного RSS item и одновременно не теряет незавершённую доставку.

### Vacancy state

```text
new → scoring pending → completed/no delivery
                      → completed/delivery pending → telegram sent
                      → error → retry due
```

`seen`, `scored` и `telegram_sent` — разные состояния.

### Provider state

- authentication/permission failure открывает circuit до manual reset;
- rate limit открывает короткий cooldown;
- transient/timeout сначала переводит provider в degraded, повторный failure открывает circuit;
- model unavailable или broken contract использует model fallback, а не второй key без причины.

## Retry budget

- Habr RSS/fetch: максимум 2 встроенные попытки node;
- HH search/detail: максимум 2 встроенные HTTP attempts; search depth — один день и 100 items на scope;
- source fetch/normalization: максимум 3 execution attempts;
- NVIDIA: максимум 10 admitted vacancies суммарно для всех source branches и максимум 3 provider attempts на logical request, без ping-pong;
- Telegram: максимум 2 node attempts, затем durable delivery retry;
- scheduler: один Schedule Trigger каждые 10 минут; run initializer ведёт метрики, но не содержит lock, retry или дополнительный time gate.

## Security boundaries

- bot token, NVIDIA keys и HH OAuth client secret/tokens находятся только в n8n credential store;
- Telegram Chat ID находится только в environment;
- workflow export содержит credential references, но не values;
- NVIDIA prompt не содержит salary, contact data или полный audit profile;
- state хранит compact operational records, не raw HTML и не полные descriptions.

## Local MVP vs deployment

MARK использует bounded workflow static data с retention limits и production
concurrency `1`. Container deployment переносит всю n8n database из SQLite в
PostgreSQL через `export:entities` / `import:entities`, поэтому workflow,
credentials, ownership и накопленный compact state переживают restart и
перенос сервера.

Это улучшает database durability, но не меняет application-level state API:
источником по-прежнему остаётся `getWorkflowStaticData('global')`. Для текущего
single-user cadence это контролируемый компромисс. Масштабирование, несколько
workers или более частые записи потребуют отдельного checkpoint с Data Table
или собственными PostgreSQL tables и повторением duplicate/failure regression
matrix.

Container boundary, migration, backup и rollback описаны в `DEPLOYMENT.md`.
