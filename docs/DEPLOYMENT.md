# MARK — Container Deployment

## Статус

Container package подготовлен для целевого Ubuntu 24.04 VPS в Нидерландах.
Он не содержит secrets и не изменяет сервер автоматически. Legacy MARK
остановлен и удалён 25 июля 2026 года после verified final backup; активного
production instance сейчас нет.

Target VPS прошёл read-only resource, Docker, security и direct
Telegram/NVIDIA/HH egress audit. M3 согласовал package с Main Server contract:
external secret/migration/backup paths, Tailscale-only HTTPS и hardened backup
container проверены локальным disposable smoke. Staged deployment ещё не
выполнялся.

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

- `/etc/mark/mark.env` или его копию;
- `/var/lib/mark/migration/` и entity exports;
- PostgreSQL dumps и n8n-data archives;
- decrypted credential exports;
- `N8N_ENCRYPTION_KEY`, HH secret, NVIDIA keys, Telegram token или Chat ID.

`.gitignore`, `.dockerignore`, `workflow-structure.test.js` и
`container-deployment.test.js` проверяют эти границы. Серверный
`/etc/mark/mark.env` находится вне checkout, принадлежит root и имеет mode
`600`. Все deployment scripts используют explicit `--env-file`.

Credential migration выполняется через `export:entities` / `import:entities`.
Этот путь официально поддерживает перенос SQLite → PostgreSQL. Не использовать
`export:credentials --decrypted`: такой файл содержит открытые secrets.

Target n8n получает verified recovery `N8N_ENCRYPTION_KEY` только из
protected reconstructed bundle через отдельный защищённый канал. Его значение
записывается только во внешний server env. Original source key отсутствует,
поэтому original legacy `entities.zip` запрещено использовать для restore.

## Source export — completed

Финальный entity export уже выполнен на остановленном legacy server с тем же
Unix user и environment, что использовал `n8n-mark.service`. Entity archive и
SQLite/environment backup сохранены в ACL-protected local storage вне Git и
OneDrive; source server после проверки удалён.

M2 установил, что original entity archive имеет корректный checksum, но не
расшифровывается без утраченного source key. Для target подготовлен и проверен
reconstructed bundle: final SQLite workflows/user/project/static state +
credential blobs из локального store с точным совпадением 4/4 ID/name/type.
Clean PostgreSQL import восстановил 3 workflows и расшифровал 4/4 credentials.
На target передавать только reconstructed `entities.zip` и verified recovery
key; original artifacts сохранять неизменными как evidence.

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

На target repository размещается в `/srv/projects/mark`. SSH session остаётся
под `agentops`, а команды, которым нужен root-owned env, запускаются через
`sudo`:

```bash
cd /srv/projects/mark/deploy/mark
sudo ./scripts/prepare-runtime.sh
```

Команда создаёт:

- `/etc/mark/mark.env`, root-owned mode `600`;
- `/var/lib/mark/migration/entities`, `root:mark` mode `750`;
- `/var/lib/mark/backups`, `root:root` mode `700`.

Никаких runtime files в repository tree она не создаёт. Существующий env не
перезаписывается.

Заполнить `/etc/mark/mark.env` без вывода values:

- сгенерировать новый random `POSTGRES_PASSWORD` длиной не менее 32 символов;
- скопировать verified recovery `N8N_ENCRYPTION_KEY` из reconstructed bundle;
- указать приватный `MARK_TELEGRAM_CHAT_ID`;
- задать full `MARK_DEPLOYED_COMMIT`;
- оставить `MARK_MIGRATION_DIR=/var/lib/mark/migration`;
- оставить `MARK_BACKUP_DIR=/var/lib/mark/backups`;
- заменить example tailnet hostname фактическим `*.ts.net`;
- оставить `GENERIC_TIMEZONE=Europe/Moscow`;
- оставить `MIGRATION_REQUIRED=true`.

Затем:

```bash
sudo chmod 600 /etc/mark/mark.env
sudo ./scripts/check-env.sh
```

## Entity restore

Передать только reconstructed export в:

```text
/var/lib/mark/migration/entities/entities.zip
```

После завершения передачи создать marker:

```bash
sudo touch /var/lib/mark/migration/READY
sudo chmod 600 /var/lib/mark/migration/READY
```

Выполнить:

```bash
sudo ./scripts/restore-entities.sh
```

Restore script:

1. поднимает только PostgreSQL;
2. импортирует entities в пустую target database;
3. принудительно unpublish всех workflows;
4. создаёт `/var/lib/mark/migration/RESTORED`;
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
sudo ./scripts/verify.sh
```

Script проверяет containers, n8n health, egress к Telegram/NVIDIA/HH и
54-node workflow без provider credential calls и без Telegram delivery.

Далее вручную проверить четыре credentials в n8n и выполнить controlled smoke:

- HH OAuth search;
- NVIDIA score;
- Telegram delivery только явно помеченной synthetic vacancy.

После подтверждения:

```bash
sudo ./scripts/publish-main.sh
```

Команда unpublish всех workflows, публикует только
`RO4i4YmNzEzC2TEV`, перезапускает n8n и ждёт health.

Cutover считается завершённым только после:

1. двух automatic 10-minute ticks без overlap и duplicates;
2. доставки с выключенным Windows bridge;
3. `docker compose restart` или server reboot;
4. повторного health/egress check;
5. наличия свежей backup pair + manifest в `/var/lib/mark/backups/`.

Не создавать второй опубликованный MARK во время target verification.

## Backups and recovery

`backup` service сразу после старта, затем раз в сутки создаёт:

- `mark-postgres-*.dump`;
- `mark-n8n-data-*.tgz`;
- `mark-backup-*.manifest` с deployed commit, image versions и checksums пары.

Files находятся во внешнем `/var/lib/mark/backups/` и удаляются после
`BACKUP_RETENTION_DAYS`. Backup container не имеет Docker socket/host network,
работает с `no-new-privileges` и `cap_drop: ALL`. Для disaster recovery отдельно
хранить:

- recovery-копию `/etc/mark/mark.env` в password manager или encrypted offline
  storage;
- свежую пару database/n8n-data backup;
- repository commit, соответствующий deployed workflow.

Backup на том же VPS защищает от ошибки приложения, но не от потери всего
сервера. После cutover нужно настроить off-server encrypted copy на уровне
server infrastructure.

## Rollback

Если target smoke или первые ticks не проходят:

1. `sudo docker compose --env-file /etc/mark/mark.env -f compose.yaml exec -T -u node n8n n8n unpublish:workflow --all`;
2. `sudo docker compose --env-file /etc/mark/mark.env -f compose.yaml stop n8n backup`;
3. убедиться, что target не выполняет Schedule Trigger;
4. исправить target и повторить restore из reconstructed entity archive;
5. при повреждении entity export использовать protected
   `reconstructed-source.sqlite` с verified recovery key в disposable n8n
   `2.29.10`, повторить `export:entities` и удалить disposable environment
   после проверки.

Legacy VPS rollback больше недоступен и не должен планироваться как fallback.
