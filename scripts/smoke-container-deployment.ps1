[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

function Invoke-Docker {
    param(
        [Parameter(Mandatory)]
        [string[]]$Arguments,
        [switch]$DiscardOutput
    )

    if ($DiscardOutput) {
        & docker @Arguments | Out-Null
    }
    else {
        & docker @Arguments
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Docker command failed with exit code $LASTEXITCODE."
    }
}

$repoRoot = Split-Path $PSScriptRoot -Parent
$composeFile = Join-Path $repoRoot "deploy\mark\compose.yaml"
$tag = [guid]::NewGuid().ToString("N").Substring(0, 10)
$project = "mark-m3-$tag"
$tempParent = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "Temp"))
$tempRoot = [IO.Path]::GetFullPath((Join-Path $tempParent $project))
if (-not $tempRoot.StartsWith($tempParent, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to use a temporary path outside the expected parent."
}

$envFile = Join-Path $tempRoot "mark.env"
$migrationDirectory = Join-Path $tempRoot "migration"
$backupDirectory = Join-Path $tempRoot "backups"
$port = Get-Random -Minimum 22000 -Maximum 42000
$composeArguments = @(
    "compose",
    "-p", $project,
    "--env-file", $envFile,
    "-f", $composeFile
)
$started = $false

try {
    New-Item -ItemType Directory -Path $migrationDirectory | Out-Null
    New-Item -ItemType Directory -Path $backupDirectory | Out-Null

    $databasePassword = [Convert]::ToBase64String(
        [Security.Cryptography.RandomNumberGenerator]::GetBytes(36)
    )
    $encryptionKey = [Convert]::ToBase64String(
        [Security.Cryptography.RandomNumberGenerator]::GetBytes(36)
    )
    $commit = (& git -C $repoRoot rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $commit -notmatch "^[a-f0-9]{40}$") {
        throw "Unable to resolve the repository commit."
    }

    $environment = @(
        "N8N_VERSION=2.29.10"
        "POSTGRES_VERSION=16-alpine"
        "POSTGRES_DB=n8n"
        "POSTGRES_USER=mark_n8n"
        "POSTGRES_PASSWORD=$databasePassword"
        "N8N_ENCRYPTION_KEY=$encryptionKey"
        "MARK_TELEGRAM_CHAT_ID=100000001"
        "GENERIC_TIMEZONE=Europe/Moscow"
        "MARK_BIND_PORT=$port"
        "MIGRATION_REQUIRED=false"
        "MARK_MIGRATION_DIR=$($migrationDirectory.Replace('\', '/'))"
        "MARK_BACKUP_DIR=$($backupDirectory.Replace('\', '/'))"
        "MARK_DEPLOYED_COMMIT=$commit"
        "N8N_HOST=mark-smoke.example.ts.net"
        "N8N_PROTOCOL=https"
        "WEBHOOK_URL=https://mark-smoke.example.ts.net/"
        "N8N_EDITOR_BASE_URL=https://mark-smoke.example.ts.net/"
        "N8N_PROXY_HOPS=1"
        "N8N_SECURE_COOKIE=true"
        "EXECUTIONS_DATA_MAX_AGE=168"
        "EXECUTIONS_DATA_PRUNE_MAX_COUNT=1000"
        "BACKUP_INTERVAL_SECONDS=86400"
        "BACKUP_RETENTION_DAYS=14"
    )
    [IO.File]::WriteAllLines(
        $envFile,
        $environment,
        [Text.UTF8Encoding]::new($false)
    )

    Invoke-Docker -Arguments @(
        $composeArguments
        "up", "-d", "postgres", "n8n", "backup"
    ) -DiscardOutput
    $started = $true

    $healthy = $false
    for ($attempt = 0; $attempt -lt 90; $attempt++) {
        try {
            $response = Invoke-WebRequest `
                -Uri "http://127.0.0.1:$port/healthz" `
                -UseBasicParsing `
                -TimeoutSec 3
            if ($response.StatusCode -eq 200) {
                $healthy = $true
                break
            }
        }
        catch {
            Start-Sleep -Seconds 1
        }
    }
    if (-not $healthy) {
        throw "Disposable n8n did not become healthy."
    }

    $postgresId = (& docker @composeArguments "ps" "-q" "postgres").Trim()
    $n8nId = (& docker @composeArguments "ps" "-q" "n8n").Trim()
    $backupId = (& docker @composeArguments "ps" "-q" "backup").Trim()
    if (-not $postgresId -or -not $n8nId -or -not $backupId) {
        throw "Disposable container IDs were not resolved."
    }

    $postgresPortsRaw = (
        & docker inspect $postgresId --format "{{json .NetworkSettings.Ports}}"
    ).Trim()
    $postgresPorts = $postgresPortsRaw | ConvertFrom-Json
    $publishedPostgresBindings = @(
        $postgresPorts.PSObject.Properties | Where-Object {
            $null -ne $_.Value -and @($_.Value).Count -gt 0
        }
    )
    if ($publishedPostgresBindings.Count -ne 0) {
        throw "PostgreSQL unexpectedly publishes a host port."
    }

    $n8nBinding = (& docker port $n8nId "5678/tcp").Trim()
    if ($n8nBinding -ne "127.0.0.1:${port}") {
        throw "n8n is not bound exclusively to the expected loopback port."
    }

    $backupCaps = (& docker inspect $backupId --format "{{json .HostConfig.CapDrop}}").Trim()
    $backupSecurity = (& docker inspect $backupId --format "{{json .HostConfig.SecurityOpt}}").Trim()
    if ($backupCaps -notmatch '"ALL"') {
        throw "Backup container did not drop all capabilities."
    }
    if ($backupSecurity -notmatch "no-new-privileges") {
        throw "Backup container lacks no-new-privileges."
    }

    $backupReady = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        $dump = Get-ChildItem $backupDirectory -Filter "mark-postgres-*.dump" -File |
            Select-Object -First 1
        $archive = Get-ChildItem $backupDirectory -Filter "mark-n8n-data-*.tgz" -File |
            Select-Object -First 1
        $manifest = Get-ChildItem $backupDirectory -Filter "mark-backup-*.manifest" -File |
            Select-Object -First 1
        if ($dump -and $archive -and $manifest) {
            $backupReady = $true
            break
        }
        Start-Sleep -Seconds 1
    }
    if (-not $backupReady) {
        throw "Disposable backup pair and manifest were not created."
    }

    Invoke-Docker -Arguments @(
        "run", "--rm",
        "-v", "$($backupDirectory.Replace('\', '/')):/backups:ro",
        "postgres:16-alpine",
        "pg_restore", "--list", "/backups/$($dump.Name)"
    ) -DiscardOutput
    Invoke-Docker -Arguments @(
        "run", "--rm",
        "-v", "$($backupDirectory.Replace('\', '/')):/backups:ro",
        "alpine:3.23",
        "tar", "-tzf", "/backups/$($archive.Name)"
    ) -DiscardOutput

    $manifestText = Get-Content $manifest.FullName -Raw
    if (
        $manifestText -notmatch "deployed_commit=$commit" -or
        $manifestText -notmatch "n8n_image=docker.n8n.io/n8nio/n8n:2.29.10" -or
        $manifestText -notmatch "postgres_image=postgres:16-alpine"
    ) {
        throw "Backup manifest does not bind artifacts to the deployment."
    }

    Write-Output "M3_DISPOSABLE_COMPOSE_SMOKE=passed"
    Write-Output "M3_LOOPBACK_ONLY=passed"
    Write-Output "M3_EXTERNAL_BACKUP_PAIR=passed"
    Write-Output "M3_BACKUP_HARDENING=passed"
}
finally {
    if ($started -and $project -like "mark-m3-*") {
        & docker @composeArguments down --volumes --remove-orphans *> $null
    }

    $resolvedTemp = [IO.Path]::GetFullPath($tempRoot)
    if (
        $resolvedTemp.StartsWith($tempParent, [StringComparison]::OrdinalIgnoreCase) -and
        (Split-Path $resolvedTemp -Leaf) -like "mark-m3-*"
    ) {
        Remove-Item -LiteralPath $resolvedTemp -Recurse -Force -ErrorAction SilentlyContinue
    }
}
