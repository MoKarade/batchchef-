# BatchChef — Restart Cheatsheet

**After a reboot, double-click `start.ps1`.** Everything comes up clean.

## One-click startup

```powershell
# From the repo root:
.\start.ps1
```

The script:
1. Confirms the Redis Windows service is Running (auto-starts at boot anyway).
2. Sweeps ports 8000/8001/3000 for stale processes.
3. Opens **6 new PowerShell windows**, one per service:
   - **API** (uvicorn with `--reload` on :8001)
   - **Worker 1, 2, 3** (Celery `--pool=solo`, parallel tasks)
   - **Beat** (scheduled: hourly zombie cleanup, nightly DB backup at 03:17)
   - **Frontend** (`npm run dev` on :3000)
4. Waits for `/api/health` to answer 200.
5. Refreshes `IngredientMaster.usage_count` (keeps the price-mapping init query at ~27 ms).
6. Opens http://localhost:3000/planifier in the browser.

## One-click stop

```powershell
.\stop.ps1
```

Kills everything listening on :8001 and :3000 plus any python.exe running celery/uvicorn. Leaves Redis running (it's a system service).

## What's live after restart

| Endpoint | Purpose |
|---|---|
| `GET  /api/health` | Enriched: Redis status, Celery workers, DB size, last successful import |
| `GET  /api/stats` | Dashboard counts (cached 60s in Redis) |
| `GET  /api/stats/personal?days=90` | Personal usage stats — top recipes, weekly trend |
| `GET  /api/meal-plans/current` | Current-week Trello plan (auto-creates) |
| `POST /api/meal-plans/{id}/entries` | Add a recipe card to the board |
| `PATCH /api/meal-plans/{id}/entries/{entry_id}` | Drag-drop move |
| `POST /api/meal-plans/{id}/to-batch` | Convert week plan → Batch with shopping list |
| `GET  /api/recipes/{id}/batches` | Which batches use this recipe |
| `PATCH /api/recipes/{id}` | User notes + favorite toggle |
| `POST /api/recipes/recompute-costs` | Rebuild `estimated_cost_per_portion` from StoreProducts |
| `POST /api/recipes/refresh-ingredient-usage` | Denormalize `usage_count` for the price-mapping sort |
| `PATCH /api/batches/{id}` | Rename / change notes / set status |
| `POST /api/batches/{id}/duplicate` | Clone a batch with fresh shopping list |
| `GET  /api/chef/suggest-from-fridge` | "What can I cook with what's in my fridge?" |

## Frontend pages

| Route | Page |
|---|---|
| `/` | Dashboard (fridge suggestions, latest batch, stats) |
| `/planifier` | **Trello-style weekly board** (drag-drop recipes onto day × meal cells) |
| `/batches` | Batch list with filters, search, sort, empty states |
| `/batches/[id]` | Editable detail (rename, notes, status, duplicate, delete) |
| `/batches/new` | Config + preview + accept (state persisted in sessionStorage) |
| `/batch` | Auto + Manual generation (state persisted) |
| `/recipes/[id]` | Full detail + user notes + favorite + "used in batches" |
| `/recipes/[id]/cook` | **Fullscreen cooking mode** with per-step timer |
| `/shopping/[batchId]` | Shopping list with **Maxi/Costco filter + Exporter** (bulk-open tabs, copy, TSV) |
| `/imports` | Rich job tracker (all types, filters, WS+poll fallback) |
| `/stats` | Personal analytics (KPIs, weekly bars, top 5) |
| `/frigo` | Inventory with confirm modals |

## Known state at restart time

- **29 196 recettes** imported (67 % of the 43 492 URL catalogue — rest are dead pages on Marmiton)
- **7 655 ingredient parents** — 421 mapped, 567 invalid, 7 029 pending (price mapping to re-run)
- **218 Gemini-parse artefacts merged** into clean names (`s_de_sel` → `sel`, etc.)
- **Price mapping jobs #80/#81/#82 are FAILED** — re-launch from `/imports` when ready; the new `usage_count` column makes init instant

## Re-launch a price mapping

From the frontend → `/imports` → the three chunks are gone (fail-cleaned). Just click "Démarrer un import" isn't right for pricing — use the backend call directly:

```powershell
# All pending parents, in 3 parallel chunks
$body = @{ store_codes = @('maxi', 'costco') } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:8001/api/stores/map-prices" -Method Post -Body $body -ContentType "application/json"
```

With the 3 workers running, it'll pick the top-usage pending parents and scrape them in parallel. Expected: ~500-1000 ingredients/hour with the new query.

## Automatic maintenance

Celery Beat runs:
- **Hourly** (minute 0): `zombie_cleanup` — fails any job stuck in `running/queued` for >5 min.
- **Daily at 03:17**: `db_backup` — gzipped SQLite dump to `backups/` (keeps last 7).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `/planifier` shows "API planif indisponible" | API didn't reload new routes — restart via `stop.ps1` + `start.ps1` |
| `/api/health` says `redis.up: false` | `Start-Service Redis` (or `winget install Redis.Redis` if missing) |
| Port 8001 "already in use" | `.\stop.ps1` then `.\start.ps1` |
| Frontend shows old bundle | Hard refresh the browser (Ctrl+Shift+R) |
| Celery logs "WorkerLostError" | A scrape timed out — `task_annotations` retry will re-queue it automatically (max 3) |
| DB backup file growing huge | Retention is 7 days — older gzips are auto-deleted |

## One-off manual ops

```powershell
# Recompute recipe costs from current StoreProducts
Invoke-RestMethod -Method Post -Uri "http://localhost:8001/api/recipes/recompute-costs"

# Re-run the Gemini prefix cleanup (idempotent)
Invoke-RestMethod -Method Post -Uri "http://localhost:8001/api/ingredients/repair-prefixes"

# Force a DB backup now (instead of waiting for 03:17)
# (from a worker window or new shell)
uv run python -c "from app.workers.db_backup import run_db_backup; print(run_db_backup.apply().result)"

# Clear Redis cache (/api/stats and any other @cached endpoints)
redis-cli KEYS 'batchchef:cache:*' | ForEach-Object { redis-cli DEL $_ }
```
