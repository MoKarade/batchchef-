# Operations Runbook

## First-time setup

```bash
cd backend
uv sync
uv run playwright install chromium
uv run alembic upgrade head
# If alembic complains about multiple heads:
uv run alembic upgrade c3d4e5f6a7b8   # image_url
uv run alembic upgrade b2c3d4e5f6a7   # is_taxable

cd ../frontend && npm install
```

Start Redis (`redis-server` or Docker).

Start services (see README).

## Starting a full pipeline from zero

1. **Import all Marmiton recipes** :

   ```bash
   curl -X POST http://localhost:8000/api/imports/marmiton/continuous
   ```

   This dispatches `imports.continuous` which loops batches of 100
   until `cleaned_recipes.txt` is fully consumed. Expect **7-10 days**
   total on a laptop. Monitor via `/api/stats` and `/api/imports?limit=5`.

2. **Map prices** as recipes arrive. Either:
   - Auto-triggered by `import_marmiton` worker for new ingredients
     (see `_price_new_ingredients`)
   - OR manually kick off :
     ```bash
     curl -X POST http://localhost:8000/api/admin/full-backfill
     ```

3. **Classify ingredients** (cleans corrupted names + assigns 10-cat
   taxonomy + `is_taxable`) :

   ```bash
   curl -X POST http://localhost:8000/api/ingredients/classify
   ```

4. **Recompute recipe costs** once prices come in :

   ```bash
   curl -X POST http://localhost:8000/api/recipes/recompute-costs
   ```

## Monitoring

- **`/api/stats`** — `{total_recipes, ai_done_recipes, priced_ingredients, total_ingredients}`
- **`/api/ingredients/pricing-eta`** — live ETA from last 10 jobs average
- **`/api/ingredients/price-coverage`** — fresh / stale / missing breakdown
- **`/api/imports?limit=5`** — recent jobs + progress
- **Dashboard** — auto-refresh every few seconds
- **Settings › Outils avancés** — full backfill button

## Common issues

### "Celery auth failed: Could not resolve authentication method"

Gemini API key not loaded. Causes :
- `.env` has a BOM or CRLF line endings → run the BOM strip snippet in README
- Windows system variable `ANTHROPIC_API_KEY=""` empty overrides `.env`
  → `config.py` backfills since V3, but old processes may still fail.
  Restart Celery.

### "Gemini 3 Flash: Unterminated string / Expecting value"

Gemini occasionally returns truncated JSON. V3 sets `response_mime_type=
application/json` when the prompt mentions "JSON", which fixes most
cases. On remaining failures the worker :
- Logs a warning
- Uses fallback values (canonical_name as alias, 0.5 confidence score, etc.)
- Moves on — never blocks the pipeline.

### "Costco: no DOM products for 'X'"

Normal — Costco sells in bulk, so ~60% of ingredients have no Costco
equivalent. Not a bug unless it's 100%.

### "Costco warehouse selection failed"

OneTrust cookie banner intercepts the click. Ensure `PLAYWRIGHT_HEADLESS=
false` and the warm-up page loads fully. If chronic, run
`docker restart redis` + kill/restart Celery.

### "Job stuck in running"

`zombie-cleanup-hourly` beat task marks jobs >4h old as failed. If beat
isn't running :

```sql
UPDATE import_job SET status='failed', finished_at=CURRENT_TIMESTAMP
WHERE status IN ('queued','running') AND created_at < datetime('now','-4 hours');
```

### React "two children with the same key"

Means a duplicate was returned by an `/details` endpoint. Fixed in V3 by
deduplicating recipes by `recipe.id` server-side. If it reappears, check
the new endpoint doesn't produce duplicate rows.

### "Mappé" cards without photos

Shouldn't happen in V3 (requires `image_url` to mark mapped). If it does :

```sql
-- See offenders
SELECT ingredient_master.id, canonical_name
FROM ingredient_master
JOIN store_product ON store_product.ingredient_master_id = ingredient_master.id
WHERE ingredient_master.price_mapping_status = 'mapped'
  AND store_product.image_url IS NULL;

-- Fix: unmap them so the next rescan re-tries the CDN HEAD
UPDATE ingredient_master SET price_mapping_status = 'pending'
WHERE id IN (SELECT im.id FROM ingredient_master im
             JOIN store_product sp ON sp.ingredient_master_id = im.id
             WHERE im.price_mapping_status = 'mapped' AND sp.image_url IS NULL);
```

## Scale estimates

| Work | Count | Throughput | ETA |
|---|---|---|---|
| Import Marmiton (remaining) | ~33 000 URLs | 25 s/URL | **9-10 days** |
| Map prices (all) | 15 389 ingredients × 2 stores | 16 s/ing avg | **~3 days** |
| Classify ingredients (10 cat) | 15 389 in batches of 30 | ~10 s/batch | **~2 hours** |
| Recompute recipe costs | 10 000+ recipes | in-memory | **<1 min** |

## Backup & auto-snapshot (committed to git)

### Automatic hourly snapshot

V3 ships with a **Windows Task Scheduler** entry that runs
`scripts/snapshot_db.bat` every hour :

1. Hot-backup `batchchef.db` → `batchchef.seed.db` (safe during concurrent
   writes — uses SQLite's online `.backup` API)
2. `git add backend/batchchef.seed.db`
3. Commits with `"Auto-snapshot: N recipes, M priced"` (fetched from
   `/api/stats`)
4. `git push origin HEAD`

Result: `git pull` on another machine always yields a recent snapshot.

### Manage the task

```powershell
schtasks /Query /TN "BatchChefSnapshot"               # show status
schtasks /Run   /TN "BatchChefSnapshot"               # run now
schtasks /Change /TN "BatchChefSnapshot" /RI 30 /DU 9999:59   # every 30 min
schtasks /Delete /TN "BatchChefSnapshot" /F           # disable auto-snapshot
```

Re-create it anytime :

```powershell
schtasks /Create /TN "BatchChefSnapshot" ^
  /TR "C:\Users\<you>\...\batch-cooking\scripts\snapshot_db.bat" ^
  /SC HOURLY /MO 1 /F
```

### Manual one-off snapshot

```bash
python scripts/snapshot_db.py
```

Exit codes: `0` ok (pushed or no changes), `1` git error, `2` db error.

### Adhoc SQL backup

```bash
sqlite3 backend/batchchef.db ".backup 'backup-$(date +%Y%m%d).db'"
```

## Resetting

**Full wipe** (danger):

```bash
rm backend/batchchef.db
cd backend && uv run alembic upgrade head
# then restart backend — it re-seeds stores on first start
```

**Partial** — remove prices only :

```sql
DELETE FROM price_history;
DELETE FROM store_product;
UPDATE ingredient_master SET price_mapping_status='pending', last_price_mapping_at=NULL;
```

## Upgrading from V2

1. Pull the `pricing-pipeline` branch.
2. `uv sync` (adds `google-genai`, `patchright`, etc.).
3. `uv run alembic upgrade head`.
4. Update `.env` with `GEMINI_API_KEY`, remove `ANTHROPIC_API_KEY` if
   unused.
5. Restart all 3 services.
