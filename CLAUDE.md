# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Read `HANDOFF.md` at the repo root first** — it tracks the state of the most recent refonte (preview/accept batch flow, auto-cascade import pipeline) and the gotchas that are not obvious from the code alone.

## Project Overview

**BatchChef V2** is an intelligent batch cooking planner. It scrapes recipes from Marmiton, integrates grocery pricing (Maxi, Costco, local stores), and uses Google Gemini AI to standardize ingredients, classify recipes, and perform receipt OCR.

## Development Setup

### Backend (FastAPI + Python 3.14)
```bash
cd backend
cp .env.example .env          # fill in GEMINI_API_KEY
uv sync
uv run playwright install chromium
```

### Frontend (Next.js)
```bash
cd frontend
npm install
```

### Running Locally (3 terminals)
```bash
# Terminal 1 — API
cd backend && uv run uvicorn app.main:app --reload --port 8001

# Terminal 2 — Celery worker (required for import jobs)
cd backend && uv run celery -A app.workers.celery_app worker --loglevel=info --pool=solo

# Terminal 3 — Frontend
cd frontend && npm run dev     # http://localhost:3000
```

### Docker (all-in-one)
```bash
docker compose up --build
```

### Frontend commands
```bash
npm run dev      # dev server
npm run build    # production build
npm run lint     # ESLint
```

### Backend tests
```bash
cd backend && uv run pytest tests/
```

## Architecture

### Request Flow
Browser → Next.js (`:3000`) → FastAPI (`:8001`) → SQLite / Redis+Celery

Next.js rewrites `/api/*`, `/ws/*`, `/uploads/*` to the FastAPI backend, so the frontend never calls the backend directly except through these rewrites.

### Backend layout (`backend/app/`)
| Directory | Purpose |
|---|---|
| `models/` | SQLAlchemy 2.0 async ORM models |
| `routers/` | FastAPI route handlers |
| `services/` | Business logic (batch generator, inventory, unit converter) |
| `ai/` | Gemini integration: `standardizer.py`, `classifier.py`, `receipt_ocr.py` |
| `scrapers/` | Playwright scrapers: `marmiton.py` (JSON-LD + CSS fallback), `maxi.py` |
| `workers/` | Celery tasks: `import_marmiton`, `process_receipt` |
| `websocket/` | WebSocket manager for real-time import progress |

### Frontend layout (`frontend/`)
- `app/` — Next.js App Router pages
- `components/` — React components
- `lib/api.ts` — Axios wrapper + TypeScript types for all API calls

**Important:** This project uses Next.js 16 which has breaking changes from prior versions. Before editing frontend code, read `node_modules/next/dist/docs/` and heed deprecation notices — APIs, conventions, and file structure differ from older Next.js.

### Key data models
- **Recipe** — normalized to `servings=1`; all ingredient quantities stored as `quantity_per_portion` for uniform scaling
- **IngredientMaster** — canonical ingredient names (e.g., `huile_olive`); recipes link to masters via `RecipeIngredient`
- **Batch** → **BatchRecipe** (recipe + portions) → **ShoppingListItem** (priced, deducted from inventory)
- **ImportJob** — tracks Celery task progress; frontend polls via WebSocket at `WS /ws/jobs/{job_id}`

### Core data flows

**Recipe import:**
`POST /api/imports/marmiton` → Celery task → Playwright scrapes Marmiton URLs in batches of 5 → Gemini standardizes ingredient names (50/request) → Gemini classifies recipes → WebSocket broadcasts progress

**Batch generation (two-phase, preferred):**
- `POST /api/batches/preview` → runs full selection + shopping list computation, returns `BatchPreviewOut` **without touching the DB**
- `POST /api/batches/accept` → takes `{target_portions, recipes: [{recipe_id, portions}]}` and persists the batch + shopping list

**Batch generation (legacy one-shot, kept for back-compat):**
`POST /api/batches/generate` → picks diverse recipes → persists in one call → returns `Batch` + `ShoppingListItem[]`

**Shopping list bulk actions:**
- `POST /api/batches/{id}/shopping-items/bulk-purchase {item_ids: [...]}` — marks multiple items purchased + settles each into inventory
- `DELETE /api/batches/{id}` — cascades `BatchRecipe` + `ShoppingListItem` removal

**Auto-cascade after Marmiton import:**
When `import_marmiton` finishes with new `IngredientMaster` rows, it queues `prices.estimate_fruiterie` + `prices.map` (Maxi + Costco) scoped to the new IDs. Users don't click "Map prices" manually anymore — the buttons are still there but hidden under "Outils avancés" in Settings.

**Receipt OCR:**
`POST /api/receipts` (multipart) → Gemini Vision extracts product lines → frontend validates → inventory updated

### Environment variables (`.env`)
- `GEMINI_API_KEY` — required for AI features
- `DATABASE_URL` — async SQLite (default: `sqlite+aiosqlite:///./batchchef.db`)
- `REDIS_URL` — Celery broker/backend
- `GEMINI_MODEL` — `gemini-2.0-flash-exp`
- `MAXI_STORE_ID` — Maxi location ID (default: 8676)
- `SCRAPE_CONCURRENCY` — parallel Playwright pages (default: 5)

Frontend env (`.env.local`): `NEXT_PUBLIC_API_URL=http://localhost:8001`, `NEXT_PUBLIC_WS_URL=ws://localhost:8001`

### Non-obvious implementation details
- **Ingredient names use underscores** for compound names (e.g., `huile_olive`, `poivre_noir`) — this is the Gemini standardization convention
- **Playwright blocks CSS/fonts/images** during scraping to speed up Marmiton extraction (~25s timeout per URL)
- **Celery uses `--pool=solo`** on Windows (no fork support); `task_acks_late=True` and `worker_prefetch_multiplier=1` for large import safety
- **Stores are seeded on startup** via FastAPI lifespan hook (Maxi, Costco, Fruiterie 440)
- **Marmiton URLs** are pre-loaded (43,492 URLs) — import jobs consume from this list
