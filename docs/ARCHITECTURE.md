# Architecture

## Data flow

```
┌─────────────┐       ┌─────────────┐       ┌──────────────┐
│   Browser   │──────▶│  Next.js    │──────▶│   FastAPI    │
│  (React)    │       │  port 3000  │       │  port 8000   │
└─────────────┘       └─────────────┘       └──────┬───────┘
                         /api/* proxy rewrite       │
                                                    ▼
                                            ┌──────────────┐
                                            │   SQLite     │
                                            │  (async)     │
                                            └──────▲───────┘
                                                   │
                         ┌─────────────────────────┘
                         ▼
                   ┌──────────────┐      ┌──────────────┐
                   │   Celery     │◀────▶│    Redis     │
                   │   (solo)     │      │  broker+resp │
                   └──┬───┬───┬───┘      └──────────────┘
                      │   │   │
            ┌─────────┘   │   └──────────────┐
            ▼             ▼                  ▼
      ┌──────────┐ ┌──────────┐       ┌──────────┐
      │Playwright│ │ Gemini   │       │  OFF API │
      │ Maxi+Cos │ │ 3 Flash  │       │ nutrition│
      └──────────┘ └──────────┘       └──────────┘
```

## Data model (SQLite)

Tables clés (`backend/app/models/`) :

| Table | Rôle |
|---|---|
| `recipe` | Recettes Marmiton normalisées à `servings=1`. Stocke `marmiton_url`, `estimated_cost_per_portion`, `health_score`, statut AI. |
| `recipe_ingredient` | Ligne de recette (quantité PAR PORTION, unité, note). FK vers `ingredient_master`. |
| `ingredient_master` | Ingrédient canonique (`canonical_name`, `display_name_fr`, `category`, `is_produce`, `is_taxable`, `parent_id`). Hiérarchie parent/enfant pour variantes. |
| `store` | Maxi / Costco / Fruiterie (seeded au démarrage via lifespan hook). |
| `store_product` | Produit dans un magasin pour un ingrédient : `product_name`, `product_url`, **`image_url`**, `price`, `format_qty`, `format_unit`, `confidence_score`, `is_validated`. |
| `price_history` | Snapshot du prix à chaque scrape. Source pour sparkline + trend detection. |
| `inventory_item` | Stock courant (par ingrédient, unité, date d'achat, expiration). |
| `batch` → `batch_recipe` → `shopping_list_item` | Un batch = N portions de M recettes + liste de courses avec packages à acheter et coût estimé. |
| `import_job` | Tout job async (import marmiton, map-prices, classify…). Progression, erreurs JSON, `celery_task_id`, `cancel_requested`. |

### Migrations Alembic (ordre)

```
61bc335b03d5 (initial)
  → f1a2b3c4d5e6 (sprint2: cancel_requested, price_mapping_status)
    → a3c7d1e2f4b5 (ingredient parent/child hierarchy)
      → e533acb00b56 (user auth - still in DB, bypassed at app level)
        → b7c8d9e0f1a2 (search_aliases, price_map_attempts, recipe.pricing_status)
          → c3d4e5f6a7b8 (store_product.image_url)     ← HEAD
        → b2c3d4e5f6a7 (ingredient_master.is_taxable)   ← parallel head on some setups
```

> ⚠ Si `alembic upgrade head` se plaint de multiple heads, lancer :
> `alembic upgrade c3d4e5f6a7b8 && alembic upgrade b2c3d4e5f6a7`
> puis créer un merge revision.

## Request flow — example: generating a batch

```
POST /api/batches/preview
  ↓
batch_generator.preview_for_recipes()
  ├── _aggregate_needs()        ← sum ingredients across recipes x portions
  ├── _resolve_inventory_and_products()
  │     ├── InventoryItem query (FIFO by purchased_at)
  │     └── StoreProduct query (ordered by is_validated desc, price asc)
  ├── _compute_shopping_row() × N
  │     └── get_scale_factor() + convert_count_to_mass() fallback
  │         (fixes "12 abricots → 48g" unit mismatch)
  ├── totals_by_mode ← recompute cost as if 100% Maxi, 100% Costco, mixte
  └── Compute TPS 5% + TVQ 9.975% on is_taxable items
```

## Background workers (Celery)

Enregistrés dans `app/workers/celery_app.py`. Détails complets : [JOBS.md](JOBS.md).

| Task name | Worker file | Trigger |
|---|---|---|
| `app.workers.import_marmiton.run_marmiton_import` | import_marmiton.py | POST `/api/imports/marmiton` |
| `imports.continuous` | continuous_import.py | POST `/api/imports/marmiton/continuous` |
| `prices.map` | map_prices.py | POST `/api/stores/map-prices` |
| `prices.validate` | validate_prices.py | beat: Mondays 03:00 |
| `prices.retry_missing` | retry_missing_prices.py | beat: daily 03:30 |
| `prices.estimate_fruiterie` | estimate_fruiterie_prices.py | POST `/api/stores/fruiterie_440/estimate-prices` |
| `ingredients.classify` | classify_ingredients.py | POST `/api/ingredients/classify` |
| `ingredients.clean_display_names` | clean_display_names.py | POST `/api/ingredients/sanitize-names` |
| `classify_recipes.run` | classify_recipes.py | POST `/api/recipes/classify-pending` |
| `process_receipt.run` | process_receipt.py | POST `/api/receipts` (auto) |
| `app.workers.zombie_cleanup.run_zombie_cleanup` | zombie_cleanup.py | beat: hourly (kills jobs stuck >4h) |

## WebSocket — live job progress

Routeur : `app/websocket/manager.py` + `app/routers/ws.py`.
Endpoint : `WS /ws/jobs/{job_id}` (broadcast `{current, total, status, current_item}`).
Frontend : `frontend/lib/ws.ts` → `useJobWebSocket(jobId, handler)`.

## Configuration loading

`app/config.py` :

1. `dotenv_values(".env")` is read and **copied into `os.environ` for any
   missing/empty key** — works around Windows-set empty system env vars.
2. `pydantic_settings.BaseSettings` then reads normally.
3. Default model: `gemini-3-flash-preview`, fallback `gemini-3.1-flash-lite-preview`.

## Re-enabling auth

V3 stubs out `frontend/lib/auth.tsx` for local use. To re-enable :

1. `git log --oneline -- frontend/lib/auth.tsx` → find the pre-v3 version
2. Restore it : `git checkout <sha> -- frontend/lib/auth.tsx`
3. Restore `frontend/app/login/page.tsx` and `frontend/app/register/page.tsx`
4. Restore the account widget block in `frontend/components/layout/Sidebar.tsx`
5. Backend JWT validation is still live (`backend/app/auth.py`).

## Seeded data

`app/main.py` lifespan hook (`_seed_stores()`) inserts Maxi / Costco /
Fruiterie 440 if not present. No other auto-seed.

## Important conventions

- **Ingredient names** use **underscores** for compound names
  (`huile_olive`, `poivre_noir`). This is the Gemini prompt contract.
- **Quantities** are always stored PER PORTION on `recipe_ingredient`. Batch
  generator multiplies by `batch_recipe.portions`.
- **Celery `--pool=solo`** on Windows (no fork support).
- **Playwright** blocks CSS/fonts/images during Marmiton scrape to go fast
  (~25s per URL).
- **Costco scraper** must run **headful** (patchright) to bypass Akamai.
