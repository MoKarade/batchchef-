# BatchChef — start-all script
# --------------------------------------------------------------------------
# Run after a reboot to bring the full stack up in clean separate windows.
# Double-click this file (or ``pwsh -File start.ps1``) to launch.
#
# What it does:
#   1. Confirms Redis service is Running (auto-start at boot normally)
#   2. Opens one new PowerShell window per service:
#        - FastAPI (uvicorn with --reload on :8000)
#        - Celery worker 1, 2, 3 (--pool=solo on Windows)
#        - Celery Beat (scheduled zombie cleanup + nightly DB backup)
#        - Next.js dev server (:3000)
#   3. Waits until http://localhost:8000/api/health returns 200, then:
#        - Refreshes the IngredientMaster.usage_count cache
#        - Opens the browser at /planifier
#
# Kill everything with ``stop.ps1`` (or just close the windows).
# --------------------------------------------------------------------------

$ErrorActionPreference = "Continue"
$Repo = $PSScriptRoot
$Back = Join-Path $Repo "backend"
$Front = Join-Path $Repo "frontend"

function Info($msg) { Write-Host "[start] $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "[ ok  ] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "[warn ] $msg" -ForegroundColor Yellow }

Info "BatchChef startup — $(Get-Date -Format 'HH:mm:ss')"

# ── Redis ──────────────────────────────────────────────────────────────────
$redis = Get-Service -Name Redis -ErrorAction SilentlyContinue
if ($redis) {
    if ($redis.Status -ne 'Running') {
        Info "Starting Redis service..."
        Start-Service -Name Redis
    }
    Ok "Redis service: $($redis.Status)"
} else {
    Warn "Redis service not found — trying to start redis-server.exe manually"
    $rPath = "$env:ProgramFiles\Redis\redis-server.exe"
    if (Test-Path $rPath) {
        Start-Process $rPath -WindowStyle Minimized
        Ok "Redis launched from $rPath"
    } else {
        Warn "Install Redis: winget install Redis.Redis"
    }
}

# ── Cleanup any stale Python/Node from a previous session ────────────────
Info "Sweeping stale processes on ports 8000 and 3000..."
foreach ($port in 8000, 3000) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object {
            $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
            if ($p) {
                Warn "Port $port held by $($p.ProcessName) (PID $($p.Id)) — killing"
                Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
            }
        }
}
Start-Sleep -Milliseconds 500

# ── Launch helper ──────────────────────────────────────────────────────────
function Open-Window {
    param([string]$Title, [string]$Cwd, [string]$Cmd)
    # -NoExit keeps the window alive so logs stay visible; setting a title
    # makes it easy to find the right one in the taskbar.
    $args = @(
        "-NoExit",
        "-Command",
        "`$Host.UI.RawUI.WindowTitle = '$Title'; Set-Location '$Cwd'; Write-Host '==> $Title' -ForegroundColor Cyan; $Cmd"
    )
    Start-Process powershell -ArgumentList $args
}

# ── FastAPI ────────────────────────────────────────────────────────────────
Info "Launching API..."
Open-Window "BatchChef · API (uvicorn)" $Back `
    "uv run uvicorn app.main:app --reload --port 8000"

# ── Celery workers (3× solo = 3 tasks in parallel) ─────────────────────────
for ($n = 1; $n -le 3; $n++) {
    Info "Launching worker$n..."
    Open-Window "BatchChef · Worker $n" $Back `
        "uv run celery -A app.workers.celery_app worker --loglevel=info --pool=solo --hostname=worker$n@%h"
}

# ── Celery Beat (scheduled tasks) ──────────────────────────────────────────
Info "Launching beat..."
Open-Window "BatchChef · Beat" $Back `
    "uv run celery -A app.workers.celery_app beat --loglevel=info"

# ── Frontend ───────────────────────────────────────────────────────────────
Info "Launching frontend..."
Open-Window "BatchChef · Frontend (Next.js)" $Front "npm run dev"

# ── Wait for API ready, then refresh usage_count and open browser ─────────
Info "Waiting for API on :8000..."
$maxWait = 60
for ($i = 0; $i -lt $maxWait; $i++) {
    try {
        $r = Invoke-RestMethod -Uri "http://localhost:8000/api/health" -TimeoutSec 2
        Ok "API ready: $($r.status) · Redis=$($r.redis.up) · workers=$($r.celery.worker_count)"
        break
    } catch {
        Start-Sleep -Seconds 1
    }
}

# Refresh usage_count in case new recipes were imported since last refresh.
# This is idempotent and takes ~13s on the current DB.
Info "Refreshing IngredientMaster.usage_count..."
try {
    $usage = Invoke-RestMethod -Uri "http://localhost:8000/api/recipes/refresh-ingredient-usage" -Method Post -TimeoutSec 60
    Ok "Usage refreshed: $($usage.updated) rows, $($usage.parents) parents, $($usage.variants) variants"
} catch {
    Warn "Usage refresh failed — will use cached values ($_)"
}

# Open the frontend in the default browser
Info "Opening http://localhost:3000/planifier..."
Start-Process "http://localhost:3000/planifier"

Write-Host ""
Ok "All services launched. Close the individual windows to stop them, or run stop.ps1."
Write-Host ""
Write-Host "Useful URLs:" -ForegroundColor Cyan
Write-Host "  Frontend      : http://localhost:3000" -ForegroundColor Gray
Write-Host "  API docs      : http://localhost:8000/docs" -ForegroundColor Gray
Write-Host "  Health        : http://localhost:8000/api/health" -ForegroundColor Gray
Write-Host "  Planif Trello : http://localhost:3000/planifier" -ForegroundColor Gray
Write-Host "  Imports track : http://localhost:3000/imports" -ForegroundColor Gray
Write-Host "  Stats perso   : http://localhost:3000/stats" -ForegroundColor Gray
Write-Host ""
Write-Host "Press Enter to close this launcher window."
Read-Host | Out-Null
