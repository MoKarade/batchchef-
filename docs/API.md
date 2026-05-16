# REST API Reference

Base URL: `http://localhost:8000`
Swagger UI: `http://localhost:8000/docs`

## Ingredients

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/ingredients` | List with filters + pagination (search, category, price_mapping_status, parent_id, freshness=fresh\|stale\|missing). Each card now includes `primary_image_url`, `primary_store_code`, `computed_unit_price` + `computed_unit_label` |
| GET | `/api/ingredients/count` | Count for the same filter |
| GET | `/api/ingredients/categories` | Distinct `category` list |
| GET | `/api/ingredients/{id}/details` | Full detail: `store_products[]` (all stores, HEAD-verified images), `recipes[]` (up to 50, deduplicated), `price_history[]` (last 30 points) |
| PATCH | `/api/ingredients/{id}` | Edit display_name_fr / category / is_taxable / etc. |
| POST | `/api/ingredients/{id}/unmap` | Reset price_mapping_status → pending |
| GET | `/api/ingredients/price-coverage` | Aggregate stats: total / priced / fresh / stale / missing, by store |
| GET | `/api/ingredients/pricing-eta` | Live estimate for completing the backfill (based on last 10 jobs avg) |
| POST | `/api/ingredients/classify` | Dispatch Gemini batch: clean names + assign 10-cat taxonomy + is_taxable |
| POST | `/api/ingredients/sanitize-names` | Legacy Gemini display_name cleaner |
| POST | `/api/ingredients/repair-prefixes` | Strip bogus `-1 `, `-134 ` prefixes from canonical_name |
| POST | `/api/ingredients/refresh-prices` | Targeted re-scrape on a list of IDs (or all stale+missing if none given) |
| POST | `/api/ingredients/retry-missing-prices` | Retry ingredients with 0 products |

## Recipes

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/recipes` | List (search, meal_type, tag, **has_price=all\|priced\|missing**, sort includes **cost_desc**) |
| GET | `/api/recipes/{id}` | Detail |
| POST | `/api/recipes/classify-pending` | Fire Gemini classifier on `status="scraped"` rows |
| POST | `/api/recipes/recompute-costs` | Refresh `estimated_cost_per_portion` from current store_products |
| PATCH | `/api/recipes/{rid}/ingredients/{riid}` | Edit one ingredient line |

## Imports

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/imports/marmiton` | Dispatch one-shot batch with optional `{"limit": N}` |
| POST | `/api/imports/marmiton/continuous` | **V3** — keep importing until URL queue is empty |
| GET | `/api/imports` | Last 20 jobs (newest first) |
| GET | `/api/imports/{id}` | Single job status + error_log |
| POST | `/api/imports/{id}/cancel` | Cooperative + SIGTERM revoke |
| DELETE | `/api/imports/{id}` | Delete finished job row |

## Stores

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/stores` | List stores (Maxi, Costco, Fruiterie 440) |
| GET | `/api/stores/{code}/products` | All store_products for that store |
| PATCH | `/api/stores/{code}/prices` | Manual upsert (e.g. Fruiterie) |
| POST | `/api/stores/map-prices` | Dispatch map-prices job. Body: `{"store_codes": ["maxi"], "ingredient_ids": [1, 2]}` (both optional) |
| POST | `/api/stores/validate-prices` | Queue validation refresh (all validated store_products) |
| POST | `/api/stores/fruiterie_440/estimate-prices` | Gemini bulk estimate for Fruiterie 440 |

## Batches

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/batches/preview` | Compute batch without persisting. Body: `BatchGenerateRequest` (target_portions, num_recipes, vegetarian_only, **preferred_stores**, etc.). Returns shopping list + taxes TPS/TVQ + totals_by_mode |
| POST | `/api/batches/accept` | Persist a preview as a real batch |
| POST | `/api/batches/generate` | Legacy one-shot (preview + persist) |
| GET | `/api/batches` | List |
| GET | `/api/batches/{id}` | Detail |
| DELETE | `/api/batches/{id}` | Delete |
| PATCH | `/api/batches/{bid}/shopping-items/{iid}/purchase` | Mark line as purchased (deducts inventory) |
| PATCH | `/api/batches/{bid}/shopping-items/{iid}/unpurchase` | Undo |
| POST | `/api/batches/{bid}/shopping-items/bulk-purchase` | Bulk purchase |

## Inventory

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/inventory` | List with ingredient joined |
| POST | `/api/inventory` | Add item |
| PATCH | `/api/inventory/{id}` | Edit quantity / dates |
| DELETE | `/api/inventory/{id}` | Remove |

## Receipts

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/receipts` | Multipart upload → Gemini Vision OCR job |
| GET | `/api/receipts` | List scans |
| GET | `/api/receipts/{id}` | Detail with `items[]` |
| PATCH | `/api/receipts/{id}/confirm` | Confirm selected items → pushes to inventory |
| POST | `/api/receipts/{sid}/items` | Add a line manually |
| PATCH | `/api/receipts/{sid}/items/{iid}` | Edit line |
| DELETE | `/api/receipts/{sid}/items/{iid}` | Remove line |

## Admin

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/admin/full-backfill` | Fire **2** jobs: `prices.map` for all ingredients + `prices.estimate_fruiterie`. Long-running (30-72 h) |

## Stats

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/stats` | `{total_recipes, ai_done_recipes, total_ingredients, priced_ingredients}` |

## WebSocket

| Path | Purpose |
|---|---|
| `WS /ws/jobs/{job_id}` | Subscribe to progress updates for that job. Messages: `{job_id, current, total, status, current_item?}` |

## Auth

`POST /api/auth/login`, `POST /api/auth/register`, `GET /api/auth/me` —
**ignored in V3** frontend (stub user), but the routes still exist and
validate tokens if you re-enable auth.
