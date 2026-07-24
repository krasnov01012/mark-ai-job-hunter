# MARK — Container Deployment

## Статус

Container package подготовлен для целевого Ubuntu 24.04 VPS в Нидерландах.
Он не содержит secrets и не изменяет сервер автоматически. Legacy MARK
остановлен и удалён 25 июля 2026 года после verified final backup; активного
production instance сейчас нет.

Target VPS прошёл read-only resource, Docker, security и direct
Telegram/NVIDIA/HH egress audit. Staged deployment ещё не выполнялся. Перед
restore package должен быть согласован с Main Server contract для external
secret/migration/backup paths, private HTTPS и monitoring.

Deployment использует:

- n8n `2.29.10`, то есть ту же версию, на которой проверен workflow;
- PostgreSQL 16 как n8n database;
- persistent volumes для PostgreSQL и `/home/node/.n8n`;
- `127.0.0.1:5678`, без прямой публикации n8n в интернет;
- `restart: unless-stopped`, health checks и production concurrency `1`;
- ежедневный PostgreSQL + n8n-data backup с retention 14 дней;
- timezone `Europe/Moscow`, независимо от нидерландского региона сервера.

Application-level dedupe по-прежнему использует bounded
`getWorkflowStaticData('global')`. После entity migration эти данные хранятся
в PostgreSQL вместе с workflow. Это достаточно для текущего single-user MARK
при concurrency `1`, но не заменяет будущую миграцию контракта state в Data
Table или отдельные PostgreSQL tables.

## Security contract

Никогда не добавлять в Git:

- `deploy/mark/.env`;
- `runtime/migration/` и entity exports;
- PostgreSQL dumps и n8n-data archives;
- decrypted credential exports;
- `N8N_ENCRYPTION_KEY`, HH secret, NVIDIA keys, Telegram token или Chat ID.

`.gitignore`, `.dockerignore`, `workflow-structure.test.js` и
`container-deployment.test.js` проверяют эти границы. Серверный `.env` должен
иметь mode `600`.

Credential migration выполняется через `export:entities` / `import:entities`.
Этот путь официально поддерживает перенос SQLite → PostgreSQL. Не использовать
`export:credentials --decrypted`: такой файл содержит открытые secrets.

Для расшифровки перенесённых credentials target n8n должен получить **точно
тот же** `N8N_ENCRYPTION_KEY`, что и source instance. Передавать его нужно
отдельным защищённым каналом и записывать только в server `.env`.

## Source export — completed

Финальный entity export уже выполнен на остановленном legacy server с тем же
Unix user и environment, что использовал `n8n-mark.service`. Entity archive и
SQLite/environment backup сохранены в ACL-protected local storage вне Git и
OneDrive; source server после проверки удалён.

Ниже сохранён выполненный procedure как recovery evidence:

1. Сначала выяснить фактические `User`, `ExecStart` и `EnvironmentFile`:

   ```bash
   sudo systemctl cat n8n-mark.service
   ```

2. Подготовить root-only staging directory.
3. Остановить source n8n, чтобы state не менялся во время финального export.
4. Запустить CLI той же n8n-версии и с тем же environment:

   ```bash
   n8n export:entities --outputDir=/secure/mark-entities
   ```

5. Передать directory на target по SSH/SCP без промежуточного Git, cloud drive
   или публичной ссылки.
6. Проверить checksum и читаемость archive до удаления source.

`export:entities` переносит database entities между SQLite и PostgreSQL.
Execution history можно не включать: для MARK важны workflows, credentials,
ownership и compact durable state.

## Target preparation

На target repository размещается в `/srv/projects/mark`. После M3 contract
alignment подготовительная команда будет запускаться из:

```bash
cd /srv/projects/mark/deploy/mark
./scripts/prepare-runtime.sh
```

Команда создаёт ignored runtime directories и `.env` из безопасного template.
Она не генерирует и не перезаписывает encryption key.

Заполнить `.env`:

- сгенерировать новый random `POSTGRES_PASSWORD` длиной не менее 32 символов;
- скопировать exact source `N8N_ENCRYPTION_KEY`;
- указать приватный `MARK_TELEGRAM_CHAT_ID`;
- заменить `mark.example.com` фактическим доменом;
- оставить `GENERIC_TIMEZONE=Europe/Moscow`;
- оставить `MIGRATION_REQUIRED=true`.

Затем:

```bash
chmod 600 .env
./scripts/check-env.sh
```

## Entity restore

Передать source export в:

```text
deploy/mark/runtime/migration/entities/
```

После завершения передачи создать marker:

```bash
touch runtime/migration/READY
chmod 600 runtime/migration/READY
```

Выполнить:

```bash
./scripts/restore-entities.sh
```

Restore script:

1. поднимает только PostgreSQL;
2. импортирует entities в пустую target database;
3. принудительно unpublish всех workflows;
4. создаёт `runtime/migration/RESTORED`;
5. запускает n8n и backup service.

По умолчанию `start.sh` откажется запускать мигрируемый MARK без marker
`RESTORED`. Это защищает от случайного запуска пустого instance и потери
dedupe state.

## Private HTTPS

Target server работает в Tailscale-only режиме. Публичные `80/443` и
Cloudflare Tunnel для n8n не открывать. Базовый cutover использует Tailscale
Serve с private tailnet hostname и backend:

```text
http://127.0.0.1:5678
```

Private proxy должен передавать:

- `X-Forwarded-For`;
- `X-Forwarded-Host`;
- `X-Forwarded-Proto`.

MARK задаёт `WEBHOOK_URL` и `N8N_PROXY_HOPS=1`. В firewall публично остаётся
только SSH; `80`, `443`, `5432` и `5678` наружу не открывать.

Собственный поддомен разрешён только как private/split-DNS route с
browser-trusted DNS-01 certificate и reverse proxy, привязанным к
Tailscale-интерфейсу. Подробный target runbook и owner gates находятся в
Main Server `docs/MARK_INTEGRATION/`.

Текущий HH flow использует application OAuth `client_credentials`, поэтому
runtime search не зависит от browser callback. Redirect URI нужно менять
только после появления фактического HTTPS callback contract.

## Verification and cutover

До publication:

```bash
./scripts/verify.sh
```

Script проверяет containers, n8n health, egress к Telegram/NVIDIA/HH и
54-node workflow без provider credential calls и без Telegram delivery.

Далее вручную проверить четыре credentials в n8n и выполнить controlled smoke:

- HH OAuth search;
- NVIDIA score;
- Telegram delivery только явно помеченной synthetic vacancy.

После подтверждения:

```bash
./scripts/publish-main.sh
```

Команда unpublish всех workflows, публикует только
`RO4i4YmNzEzC2TEV`, перезапускает n8n и ждёт health.

Cutover считается завершённым только после:

1. двух automatic 10-minute ticks без overlap и duplicates;
2. доставки с выключенным Windows bridge;
3. `docker compose restart` или server reboot;
4. повторного health/egress check;
5. наличия свежих files в `runtime/backups/`.

Не создавать второй опубликованный MARK во время target verification.

## Backups and recovery

`backup` service сразу после старта, затем раз в сутки создаёт:

- `mark-postgres-*.dump`;
- `mark-n8n-data-*.tgz`.

Files находятся в ignored `deploy/mark/runtime/backups/` и удаляются после
`BACKUP_RETENTION_DAYS`. Для disaster recovery отдельно хранить:

- копию `.env` в password manager или encrypted offline storage;
- свежую пару database/n8n-data backup;
- repository commit, соответствующий deployed workflow.

Backup на том же VPS защищает от ошибки приложения, но не от потери всего
сервера. После cutover нужно настроить off-server encrypted copy на уровне
server infrastructure.

## Rollback

Если target smoke или первые ticks не проходят:

1. `docker compose exec -T -u node n8n n8n unpublish:workflow --all`;
2. `docker compose stop n8n backup`;
3. убедиться, что target не выполняет Schedule Trigger;
4. исправить target и повторить restore из сохранённого final entity archive;
5. при повреждении entity export восстановить legacy SQLite/environment backup
   в disposable n8n `2.29.10`, повторить `export:entities` и снова удалить
   disposable environment после проверки.

Legacy VPS rollback больше недоступен и не должен планироваться как fallback.
