# BatchChef — single-window launcher
# --------------------------------------------------------------------------
# ONE terminal. All services streamed with color-coded tags.
# Ctrl-C = graceful stop of everything.
#
# What it runs:
#   - [api]    FastAPI uvicorn on :8001 (with reload)
#   - [worker] Celery worker (1 instance, solo pool)
#   - [beat]   Celery beat (scheduled: zombie cleanup + nightly DB backup)
#   - [next]   Next.js dev server on :3000
#
# Extra workers? Pass ``--workers 2`` to supervisor.py.
# Individual logs per service in ``./logs/`` for later grep.
# --------------------------------------------------------------------------

$ErrorActionPreference = "Continue"
$Repo = $PSScriptRoot
$Back = Join-Path $Repo "backend"

# ── Pre-flight: Redis + sweep stale processes ───────────────────────────────
function Info($msg) { Write-Host "[start] $msg" -ForegroundColor Cyan }
function Warn($msg) { Write-Host "[warn ] $msg" -ForegroundColor Yellow }

$redis = Get-Service -Name Redis -ErrorAction SilentlyContinue
if ($redis -and $redis.Status -ne 'Running') {
    Info "Starting Redis service..."
    Start-Service -Name Redis
} elseif (-not $redis) {
    Warn "Redis service not found — install with: winget install Redis.Redis"
}

Info "Sweeping stale processes on ports 8000, 8001 and 3000..."
foreach ($port in 8000, 8001, 3000) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object {
            $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
            if ($p) {
                Warn "Port $port held by $($p.ProcessName) — killing"
                Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
            }
        }
}
# Also kill any stray celery workers that outlived a previous run
Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'celery' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Start-Sleep -Seconds 1

# ── Launch the supervisor ──────────────────────────────────────────────────
Info "Starting supervisor — all services stream here. Ctrl-C to stop."
Set-Location $Back
# UTF-8 is the sanest default for our French logs
$env:PYTHONIOENCODING = "utf-8"
uv run python supervisor.py @args
