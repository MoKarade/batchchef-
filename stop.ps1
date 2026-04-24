# BatchChef — stop-all script
# Kills uvicorn, celery workers, beat, and the Next.js dev server.
# Redis is left running (it's a system service).

$ErrorActionPreference = "Continue"

function Info($msg) { Write-Host "[stop] $msg" -ForegroundColor Cyan }
function Killed($msg) { Write-Host "[ x  ] $msg" -ForegroundColor Red }

Info "Stopping BatchChef services..."

# Kill by port — catches uvicorn (:8000) and Next.js (:3000) even if their
# parent PowerShell windows were closed uncleanly.
foreach ($port in 8000, 3000) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object {
            $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
            if ($p) {
                Killed "Port $port — $($p.ProcessName) (PID $($p.Id))"
                Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
            }
        }
}

# Kill every python.exe running celery (worker + beat).
Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'celery|uvicorn' } |
    ForEach-Object {
        Killed "$($_.Name) (PID $($_.ProcessId)) — $($_.CommandLine.Substring(0, [Math]::Min(80, $_.CommandLine.Length)))"
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }

# Kill node.exe spawned from this repo's frontend
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'batch-cooking[\\/]frontend' } |
    ForEach-Object {
        Killed "node.exe (PID $($_.ProcessId)) — Next.js dev server"
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }

Info "Done. Redis service left running."
