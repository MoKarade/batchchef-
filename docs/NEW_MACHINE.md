# Setting up on a new machine

After `git clone`, you already have:

- ✅ All source code (backend + frontend + docs)
- ✅ **`backend/batchchef.db`** — the full SQLite DB with every imported
  recipe, every scraped Maxi price, every scraped Costco price, every
  OpenFoodFacts nutrition hit, every `price_history` snapshot. No need to
  re-scrape anything to get started.
- ✅ `data/cleaned_recipes.txt` — the 43 492 Marmiton URL source list
  (used by the continuous import worker)

**What you still need to do** :

## 1. Secrets (never committed)

```bash
cp backend/.env.example backend/.env
```

Then edit `backend/.env` and set :

- `GEMINI_API_KEY` — https://aistudio.google.com/apikey
- `MAXI_STORE_ID` / `MAXI_POSTAL_CODE` — your nearest Maxi (default: 7234
  Fleur-de-Lys, Québec)
- `COSTCO_POSTAL_CODE` / `COSTCO_WAREHOUSE_NAME_HINT` — your Costco

## 2. Install dependencies

```bash
# Python
cd backend
uv sync                                 # installs everything from uv.lock
uv run playwright install chromium     # ~180 MB, only once

# Node
cd ../frontend
npm install
```

## 3. Start Redis

The Celery worker talks to Redis for queuing.

- **Windows** : `redis-server.exe`
- **macOS** : `brew services start redis`
- **Docker** : `docker run -d -p 6379:6379 redis:7-alpine`

## 4. (Optional) Migrate the DB

The committed `batchchef.db` is at whatever Alembic head the latest push
applied. If `docs/ARCHITECTURE.md` mentions a newer migration, run :

```bash
cd backend && uv run alembic upgrade head
```

## 5. Start the 3 services

```bash
# Terminal 1 — API
cd backend && uv run uvicorn app.main:app --reload --port 8000

# Terminal 2 — Celery worker
cd backend && uv run celery -A app.workers.celery_app worker \
    --loglevel=info --pool=solo

# Terminal 3 — Frontend
cd frontend && npm run dev    # → http://localhost:3000
```

Or via `.claude/launch.json` if you use Claude Code :

```
preview_start backend-api
preview_start celery-worker
preview_start frontend
```

## 6. Resume where you left off

- Dashboard (`/`) shows current stats — recipes imported, ingredients
  priced, jobs running.
- To **resume the background backfill** (if it was running on the other
  machine and you want it to continue) :

  ```bash
  curl -X POST http://localhost:8000/api/imports/marmiton/continuous
  curl -X POST http://localhost:8000/api/stores/map-prices \
       -H 'Content-Type: application/json' -d '{}'
  ```

## What's DELIBERATELY not in the repo

- `backend/.env` — secrets
- `backend/.venv/` — Python virtualenv (uv rebuilds from `uv.lock`)
- `frontend/node_modules/` — same
- `backend/uploads/` — receipt images (user-uploaded)
- `backend/batchchef.db-shm` / `.db-wal` — SQLite lock/WAL sidecars
  (auto-recreated)

If you want to reset the DB and start fresh :

```bash
rm backend/batchchef.db
cd backend && uv run alembic upgrade head
# then fire /api/imports/marmiton/continuous to repopulate
```
