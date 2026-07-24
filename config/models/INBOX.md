# Model Config Inbox

Сюда можно присылать или временно вставлять конфиги новых моделей. Рабочий runtime не читает этот файл автоматически.

Для добавления модели:

1. определить provider, точный model ID и transport;
2. создать отдельный JSON-блок в `config/models/<provider>/`;
3. проверить его по `config/models/schema/model-config.schema.json`;
4. добавить блок в нужный profile только после определения его роли;
5. выполнить live benchmark;
6. менять статус на `approved` только после успешного контракта и приемлемой задержки.

Минимальный шаблон:

```json
{
  "schema_version": "mark.model_config.v1",
  "id": "short-stable-id",
  "provider": "nvidia",
  "transport": "openai_chat_completions",
  "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
  "model": "publisher/exact-model-id",
  "modalities": {
    "input": ["text"],
    "output": ["text"]
  },
  "catalog_evidence": [],
  "mark_roles": [],
  "request_defaults": {
    "temperature": 0.1,
    "top_p": 1,
    "max_tokens": 700,
    "stream": false,
    "timeout_ms": 90000
  },
  "benchmark": {
    "timeout_ms": 45000,
    "enabled": true
  },
  "status": "candidate",
  "notes": []
}
```

API keys, tokens и credentials в этот файл и JSON-блоки не добавляются.
