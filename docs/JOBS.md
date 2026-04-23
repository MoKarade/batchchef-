# Celery Jobs Reference

All async work goes through Celery. The queue is persisted in Redis, and
the worker runs with `--pool=solo` on Windows (no fork). Every task writes
progress to `import_job` rows so the UI can poll `/api/imports/{id}`.

## Worker layout

`backend/app/workers/` :

| File | Task name | Purpose |
|---|---|---|
| `import_marmiton.py` | `app.workers.import_marmiton.run_marmiton_import` | Scrape N Marmiton URLs, standardize ingredients via Gemini, auto-trigger price mapping on new ingredients |
| `continuous_import.py` | `imports.continuous` | Loop wrapper: keeps firing `run_marmiton_import` in batches of 100 until `cleaned_recipes.txt` is fully consumed |
| `map_prices.py` | `prices.map` | Scrape Maxi + Costco for a list of ingredients; persist store_product + price_history; HEAD-verify images |
| `estimate_fruiterie_prices.py` | `prices.estimate_fruiterie` | Gemini-estimate bulk produce prices (Fruiterie 440 has no API) |
| `validate_prices.py` | `prices.validate` | Beat: Mondays 03:00 — re-scrape existing store_products to refresh price + detect changes |
| `retry_missing_prices.py` | `prices.retry_missing` | Beat: daily 03:30 — retry ingredients with 0 prices after N failed attempts |
| `clean_display_names.py` | `ingredients.clean_display_names` | Gemini re-sanitize corrupted `display_name_fr` (legacy parser artifacts) |
| `classify_ingredients.py` | `ingredients.classify` | **V3** — single-pass Gemini batch that cleans `canonical_name` AND assigns category (10 taxonomy) + is_produce + is_taxable + default_unit |
| `classify_recipes.py` | `classify_recipes.run` | Classify pending recipes → meal_type, health_score, tags |
| `process_receipt.py` | `process_receipt.run` | OCR receipt image (Gemini Vision) → line items |
| `zombie_cleanup.py` | `app.workers.zombie_cleanup.run_zombie_cleanup` | Beat: hourly — marks jobs stuck >4 h in `running`/`queued` as `failed` |

## How to trigger

Every worker has a matching REST endpoint that creates an `import_job` row
and dispatches the task :

```bash
# Full one-shot import of 500 Marmiton URLs
curl -X POST http://localhost:8000/api/imports/marmiton -H 'Content-Type: application/json' \
     -d '{"limit": 500}'

# Continuous import — keep going until cleaned_recipes.txt is fully consumed
curl -X POST http://localhost:8000/api/imports/marmiton/continuous

# Map prices for all pending ingredients
curl -X POST http://localhost:8000/api/stores/map-prices -H 'Content-Type: application/json' -d '{}'

# Map prices for a specific list
curl -X POST http://localhost:8000/api/stores/map-prices -H 'Content-Type: application/json' \
     -d '{"ingredient_ids":[117, 42, 1001]}'

# Classify + clean 10-cat taxonomy
curl -X POST http://localhost:8000/api/ingredients/classify

# Fruiterie bulk estimation
curl -X POST http://localhost:8000/api/stores/fruiterie_440/estimate-prices

# Re-cost all recipes from current store_products
curl -X POST http://localhost:8000/api/recipes/recompute-costs

# Classify pending recipes (health_score, meal_type…)
curl -X POST http://localhost:8000/api/recipes/classify-pending

# ETA for the remaining pricing work
curl http://localhost:8000/api/ingredients/pricing-eta
```

## Cancellation

`POST /api/imports/{id}/cancel` sets `cancel_requested=True` AND calls
`celery_app.control.revoke(..., terminate=True, signal="SIGTERM")`. Workers
check the flag at each iteration boundary. On Windows SIGTERM immediately
kills the worker process — restart Celery if needed.

## Beat schedule

Defined in `workers/celery_app.py::celery_app.conf.beat_schedule` :

```python
{
  "validate-prices-weekly":    crontab(hour=3, minute=0, day_of_week=1),  # Mon 03:00
  "retry-missing-prices-daily":crontab(hour=3, minute=30),                # 03:30
  "zombie-cleanup-hourly":     crontab(minute=0),                         # :00
}
```

Beat is **not** started by default — launch it with :

```bash
cd backend && uv run celery -A app.workers.celery_app beat
```

## Error logging

Each `import_job` row has `error_log` = JSON array of strings (first 50).
Typical entries :

- `"maxi:beurre: low_confidence(0.15)"` — product found, Gemini says it's not actually butter
- `"costco:oeufs: miss"` — no matching DOM product
- `"maxi:abricot_sec: missing_image"` — match + price OK but HEAD failed all 4 CDN candidates
- `"Zombie cleanup: job stuck for >4h"` — worker crashed / wedged

## Common runbook

### Restart Celery after code change

On Windows, Celery doesn't auto-reload. Must `taskkill /F /IM celery.exe`
then relaunch. When running via `preview_start`, `stop` + `start` on the
`celery-worker` serverId.

### Clear stuck jobs after a crash

```sql
UPDATE import_job SET status='failed', finished_at=CURRENT_TIMESTAMP
WHERE status IN ('queued','running') AND created_at < datetime('now','-4 hours');
```

Or just wait for `zombie-cleanup-hourly`.

### Full backfill (first time)

Dispatches 2 parallel-ish jobs :

```bash
curl -X POST http://localhost:8000/api/admin/full-backfill
```

Runs `prices.map` for all ingredients + `prices.estimate_fruiterie` for
produce. Expect **30-72 h** depending on Gemini tier.
