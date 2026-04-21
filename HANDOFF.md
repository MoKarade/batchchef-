# BatchChef V2 — Handoff document

Target audience: another AI (or developer) picking up this repo cold. Read this **before** `CLAUDE.md` and `README.md` — it covers the state of the refonte (april 2026) and the gotchas that already bit the previous agent.

---

## 1. What the last session changed

The user ([marc.richard4@gmail.com](mailto:marc.richard4@gmail.com)) asked for a full refonte of the batch creation flow + end-to-end pipeline automation. The plan is archived at `C:\Users\marcr\.claude\plans\je-veux-maintenant-que-noble-coral.md`.

### Major behavioural changes

| Area | Before | After |
|---|---|---|
| Batch generation | Single click → persisted batch | **Preview (no DB writes) → Accept (persists)** two-phase flow |
| Recipe selection | Auto only | **Auto + Manual (per-slot picker with filters)** |
| Recipe preview | Navigate to `/recipes/{id}` (loses batch context) | **Modal overlay** from any page |
| Shopping list → inventory | One-by-one checkbox | **Bulk-select + "Ajouter à l'inventaire"** |
| Inventory | Receipt OCR only | **Manual add via autocomplete modal** |
| Shopping list deletion | None | **"Supprimer" button** (cascades Batch + items) |
| Post-import price mapping | Manual buttons in Settings | **Auto-cascade** Fruiterie + Maxi + Costco after each `marmiton_bulk` job |
| Settings manual buttons | Always visible | Hidden under collapsible **"Outils avancés"** |

---

## 2. New / rewritten files

### Backend

| File | Role |
|---|---|
| `backend/app/services/batch_generator.py` | Split into pure functions: `select_recipes`, `_aggregate_needs`, `_resolve_inventory_and_products`, `_compute_shopping_row`, `_build_shopping_list_preview`, `compute_batch_preview`, `preview_for_recipes`, `persist_batch_from_slots`. Legacy `generate_batch` kept as thin wrapper for backward compat. |
| `backend/app/routers/batches.py` | New endpoints: `POST /preview`, `POST /accept`, `DELETE /{id}`, `POST /{id}/shopping-items/bulk-purchase`. Old `/generate` + single-item purchase endpoints retained. |
| `backend/app/schemas/batch.py` | New schemas: `RecipePreview`, `ShoppingItemPreview`, `BatchPreviewOut`, `RecipeSlot`, `BatchAcceptRequest`, `BulkPurchaseRequest`. |
| `backend/app/routers/recipes.py` | Added query params `max_cost_per_portion`, `prep_time_max_min`, `health_score_min` to `GET /api/recipes`. |
| `backend/app/workers/import_marmiton.py` | `_persist_recipe` now returns `set[int]` of new `IngredientMaster` IDs. End of `_run` dispatches `_dispatch_price_jobs` (Fruiterie estimate + Maxi/Costco mapping) scoped to the new IDs. |

### Frontend

| File | Role |
|---|---|
| `frontend/components/features/RecipeModal.tsx` | NEW. Read-only recipe overlay. Props: `{recipeId, portions?, onClose}`. Scales ingredient quantities by portions. Escape/click-outside closes, body scroll locked. |
| `frontend/components/features/RecipeSlotPicker.tsx` | NEW. Per-slot recipe picker with filters (search, meal_type, végé/végan, maxCost, maxPrep, minHealth). Used in manual mode. |
| `frontend/components/features/BatchPreviewStep.tsx` | NEW. Renders preview → accept. Stats card + recipe cards (with modal) + shopping list grouped by store. |
| `frontend/components/features/AddInventoryItemModal.tsx` | NEW. Autocomplete via `ingredientsApi.list({search, limit: 20})`, unit auto-syncs from `IngredientMaster.default_unit`. |
| `frontend/components/features/BatchNewPage.tsx` | Rewritten. State machine `configure → preview`. Mode toggle `auto | manual`. Calls `batchesApi.preview()` then `BatchPreviewStep` handles accept. |
| `frontend/components/features/BatchDetailPage.tsx` | "Voir" button opens `RecipeModal` instead of `<Link>`. |
| `frontend/components/features/ShoppingListPage.tsx` | Added `selectedIds: Set<number>`, per-row checkbox, sticky bottom panel with bulk "Ajouter à l'inventaire" + header "Supprimer" button. |
| `frontend/components/features/InventoryPage.tsx` | Added "Ajouter un ingrédient" button + modal. |
| `frontend/components/features/SettingsPage.tsx` | Manual pipeline panels (`PriceMappingPanel`, `FruiteriePanel`, `ClassifyPanel`) wrapped in collapsible "Outils avancés" section. |
| `frontend/lib/api.ts` | Types `BatchPreview`, `BatchAcceptRequest`, `ShoppingItemPreview`. `batchesApi` additions: `preview`, `accept`, `delete`, `bulkPurchase`. |

---

## 3. How the new batch flow works (request/response)

```
Frontend                        Backend
────────                        ───────
BatchNewPage (configure)
  mode = "auto" | "manual"
  picks = RecipeBrief[]  (manual only)
        │
        │ batchesApi.preview(req)   where req = {
        │   target_portions, num_recipes,
        │   meal_type_sequence, vegetarian_only,
        │   vegan_only, max_cost_per_portion,
        │   prep_time_max_min, health_score_min,
        │   include_recipe_ids      ← filled in manual mode
        │ }
        ▼
                              POST /api/batches/preview
                              ↓ compute_batch_preview(db, ...)
                                ↓ select_recipes()     pure, no writes
                                ↓ preview_for_recipes()
                                  ↓ _build_shopping_list_preview()
                                    returns list[dict] with embedded
                                    ingredient + store briefs
                                ← BatchPreviewOut (no id, no DB rows)
        ◄──────────────────────
BatchPreviewStep
  shows stats + recipes + shopping list
        │ on "Accepter":
        │ batchesApi.accept({
        │   target_portions,
        │   recipes: preview.recipes.map(r => ({recipe_id: r.id, portions: r.portions})),
        │ })
        ▼
                              POST /api/batches/accept
                              ↓ persist_batch_from_slots(db, target_portions, slots, name)
                                ↓ Batch + BatchRecipe + _build_shopping_list (persists)
                                ↓ commit, return eager-loaded BatchOut
        ◄── BatchOut
  router.push(`/batches/${id}`)
```

**Important invariant**: `compute_batch_preview` does not call `db.add()` or `db.commit()`. The shopping list is recomputed from scratch on `/accept` (not threaded through `/preview`), so the inventory snapshot is coherent at accept time even if minutes pass between preview and accept.

---

## 4. Auto-cascade pipeline (imports → prices)

### Flow

```
POST /api/imports/marmiton {limit: N}
  ↓ creates ImportJob (type="marmiton_bulk")
  ↓ run_marmiton_import.delay(job_id, urls)
  ↓ Celery worker picks it up
    ↓ for each URL batch:
       scrape → AI standardize → AI classify → persist
       persist returns set[int] of newly-created IngredientMaster IDs
    ↓ accumulate new_ingredient_ids: set[int]
    ↓ on completion (not cancelled) + new_ingredient_ids non-empty:
      _dispatch_price_jobs(job_id, sorted(new_ids))
        ↓ creates ImportJob(job_type="fruiterie_estimate_auto")
        ↓ creates ImportJob(job_type="price_mapping_auto")
        ↓ run_estimate_fruiterie.delay(fruit_id, ids)
        ↓ run_price_mapping.delay(map_id, ["maxi", "costco"], ids)
```

The `/imports` UI will show up to 3 jobs after a successful Marmiton import: `marmiton_bulk` (parent) + `fruiterie_estimate_auto` + `price_mapping_auto`.

The manual buttons in Settings (`/api/stores/map-prices`, `/api/stores/fruiterie_440/estimate-prices`) remain available under "Outils avancés" for re-runs after editing an ingredient.

### Pre-existing worker signatures (unchanged)
- `run_estimate_fruiterie(job_id, ingredient_ids: list[int] | None)` — `None` = all ingredients
- `run_price_mapping(job_id, store_codes: list[str] | None, ingredient_ids: list[int] | None)`

The auto-cascade relies on these already accepting scoped `ingredient_ids`.

---

## 5. Running locally (Windows)

Three terminals — **the order matters because the frontend depends on the API, and Celery depends on Redis**.

```powershell
# Terminal 1 — Redis (if not already running)
docker run -d -p 6379:6379 redis:7-alpine

# Terminal 2 — API (MUST use --reload or new routes are invisible)
cd backend
uv run uvicorn app.main:app --reload --port 8000

# Terminal 3 — Celery (Windows needs --pool=solo)
cd backend
uv run celery -A app.workers.celery_app worker --loglevel=info --pool=solo

# Terminal 4 — Frontend
cd frontend
npm run dev
```

Open http://localhost:3000. API docs: http://localhost:8000/docs.

### ⚠️ Gotcha that caused the "preview doesn't work" bug

**If uvicorn was started without `--reload`, newly-added routes (`/preview`, `/accept`, etc.) are not registered** even though the code is correct and tests pass. The symptom is a 405 "Method Not Allowed" on `POST /api/batches/preview` while the server is up.

Fix: kill uvicorn (`Stop-Process -Name python -Force` or find by PID) and restart with `--reload`.

Verify the routes are live:
```powershell
curl http://localhost:8000/openapi.json | ConvertFrom-Json | ForEach-Object { $_.paths.PSObject.Properties.Name } | Where-Object { $_ -like '*batch*' }
```
Should include `/api/batches/preview` and `/api/batches/accept`.

---

## 6. Testing

### Backend (pytest)
```powershell
cd backend
uv run pytest tests/
```
Expected: **13 passed**. The refactor keeps the legacy `generate_batch` → existing tests still cover the persistence path.

### Frontend (tsc via next build)
```powershell
cd frontend
npm run build
```
Expected: zero TS errors. 17 routes compiled.

### E2E walk-through (manual)
Plan section 11b. Walk these paths in-browser:
1. `/imports` → start Marmiton with `{limit: 3}` → verify 3 jobs appear (`marmiton_bulk` + `fruiterie_estimate_auto` + `price_mapping_auto`).
2. After all 3 complete, check `StoreProduct` rows exist for the new ingredients (Fruiterie + Maxi + Costco).
3. `/batches/new` **auto mode** → preview → accept → batch appears in `/batches`.
4. `/batches/new` **manuel mode** → choose 3 recipes with different filters → preview → modal preview of a recipe → accept.
5. `/shopping/{id}` → check 5 items → "Ajouter à l'inventaire" → confirm they appear in `/inventory`.
6. `/shopping/{id}` → "Supprimer" → confirm → redirected to `/batches`, batch is gone.
7. `/inventory` → "Ajouter un ingrédient" → autocomplete → submit → appears in list.

---

## 7. Current repo state (April 2026)

- Git: **branch `main`, one remote `origin` at `github.com/MoKarade/batchchef-`, single initial commit `cbb17a1`**. All the refonte changes are currently **uncommitted** (see `git status`).
- Running processes (if left as-is): uvicorn on `127.0.0.1:8000` with `--reload`, 2 celery solo workers on Redis `:6379`.
- Active import: **job #7** is running a `marmiton_bulk` for 500 URLs, kicked off during the last session so the DB catches up on recipes + ingredients. It will auto-cascade Fruiterie + Maxi/Costco when done.
- DB counts at handoff time: 23 recipes, 167 ingredients, last completed batch import `job #6`.

### Untracked files the next commit should include
```
backend/app/ai/utils.py
backend/app/enums.py
backend/app/utils/time.py
frontend/components/features/AddInventoryItemModal.tsx
frontend/components/features/BatchPreviewStep.tsx
frontend/components/features/RecipeModal.tsx
frontend/components/features/RecipeSlotPicker.tsx
```

**Do NOT commit** `backend/dump.rdb` (Redis dump file — should be gitignored).

---

## 8. Known constraints / gotchas

### Code-level
- **Ingredient variant rollup**: recipes reference variants (e.g. `beurre_fondu`, `parent_id=beurre.id`). `_aggregate_needs` rolls variants up to the parent so the shopping list buys one unit of "beurre". When reading a `ShoppingListItem.ingredient_master_id`, you're looking at the **parent**, not the original recipe variant.
- **Units**: quantities are scaled through `unit_converter.get_scale_factor`. Mixing units (g vs kg, ml vs l) in the same recipe is safe; mixing `unite` with mass/volume will produce separate shopping rows.
- **Celery on Windows**: always `--pool=solo`. Forking is not supported. Do NOT try to bump `worker_prefetch_multiplier` — it's kept at 1 deliberately (large Gemini batches would time out otherwise).
- **SQLAlchemy 2.0 async**: always eager-load with `selectinload()` when returning ORM objects to Pydantic. Missing eager loads cause `MissingGreenlet` at serialization time.
- **Pydantic schemas** in `backend/app/schemas/batch.py` use `from __future__ import annotations`, so forward references to `IngredientBrief`/`StoreBrief` (defined below their first use) work at runtime. Do not "fix" the ordering.

### Next.js 16
- This project uses Next.js 16 — **APIs differ from older versions**. Before touching frontend code, read `frontend/node_modules/next/dist/docs/` (enforced by `frontend/AGENTS.md`). Don't assume `pages/`-router patterns, don't assume `getServerSideProps` exists, etc.
- Rewrites are defined in `frontend/next.config.*` so `/api/*` and `/ws/*` are proxied to the FastAPI backend. Never call the backend directly from client code.

### Env / config
- `GEMINI_API_KEY` is required for AI flows. Without it, `classify_recipes`, `import_marmiton` (standardization step), receipt OCR, and Fruiterie estimation all fail.
- The Marmiton URL pool is at `backend/data/cleaned_recipes.txt` (~43k URLs) — already loaded, no action needed.

### Memory / user instructions
- Persistent memory index: `C:\Users\marcr\.claude\projects\C--Users-marcr\memory\MEMORY.md`. Project entry: `project_batchchef.md`.
- The user prefers French for UI copy and often in conversation. Backend error messages are also in French (see `select_recipes` `ValueError`).

---

## 9. What's explicitly NOT done

Hors-scope of the refonte (from plan section "Hors scope"):
- Auth changes
- DB migrations (schema is stable — only added `cascade="all, delete-orphan"` which was already there)
- Full pipeline refactor (only the cascade dispatch at the end was added)
- Deduplication of duplicate ingredients (`huile_de_tournesol` vs `huile_tournesol`)
- Changes to `RecipeDetailPage` edit flow

If the user asks for any of these next, they are **new work**, not continuation.

---

## 10. Quick command reference

```powershell
# Rebuild frontend, verify zero TS errors
cd frontend; npm run build

# Run backend tests
cd backend; uv run pytest tests/

# Kill and restart uvicorn (after adding new routes)
Get-CimInstance Win32_Process -Filter "name='python.exe'" | Where-Object CommandLine -like '*uvicorn*' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
cd backend; uv run uvicorn app.main:app --reload --port 8000

# Kick off a background Marmiton import
curl -X POST http://localhost:8000/api/imports/marmiton -H "Content-Type: application/json" -d '{"limit": 500}'

# Inspect DB counts
cd backend; uv run python -c "
import asyncio
from app.database import AsyncSessionLocal
from sqlalchemy import select, func
from app.models.recipe import Recipe
from app.models.ingredient import IngredientMaster
from app.models.job import ImportJob
async def main():
    async with AsyncSessionLocal() as db:
        print('recipes:', (await db.execute(select(func.count()).select_from(Recipe))).scalar())
        print('ingredients:', (await db.execute(select(func.count()).select_from(IngredientMaster))).scalar())
asyncio.run(main())
"
```
