# Pricing Pipeline

End-to-end: `canonical_name` → **price + photo + link** in `store_product`.

## Overview

```
           ┌───────────────────┐
           │  ingredient_master│
           │  (canonical_name) │
           └─────────┬─────────┘
                     │
                     ▼
        ┌────────────────────────┐
        │  map_prices worker     │
        │  (Celery task)         │
        └────┬──────────────┬────┘
             │              │
             ▼              ▼
   ┌───────────────┐  ┌───────────────┐
   │  Maxi scraper │  │ Costco scraper│   (Playwright/patchright)
   │               │  │ (headful)     │
   └───────┬───────┘  └───────┬───────┘
           │                  │
           ▼                  ▼
   ┌───────────────────────────────────┐
   │ Gemini validate_store_matches     │   (one API call per chunk of 30)
   │   score 0.0..1.0 per (ing, prod)  │
   └────────────────┬──────────────────┘
                    │ score ≥ 0.75
                    ▼
   ┌───────────────────────────────────┐
   │ HEAD-verify image CDN URLs        │   (4 Loblaws patterns, OFF fallback)
   └────────────────┬──────────────────┘
                    │
                    ▼
   ┌───────────────────────────────────┐
   │ store_product (price, image_url,  │
   │ product_url, format, confidence)  │
   │ + price_history snapshot          │
   └───────────────────────────────────┘
```

## Stores

Seeded at startup (`app/main.py`):

| code | name | type | scraper | notes |
|---|---|---|---|---|
| `maxi` | Maxi | supermarket | `scrapers/maxi.py` | `MAXI_STORE_ID=7234` (Fleur-de-Lys, Québec) |
| `costco` | Costco | supermarket | `scrapers/costco.py` | `COSTCO_POSTAL_CODE=G2J 1E3` (Quebec warehouse). Requires `PLAYWRIGHT_HEADLESS=false` — Akamai blocks headless |
| `fruiterie_440` | Fruiterie 440 | fruiterie | `workers/estimate_fruiterie_prices.py` | No scraper, uses Gemini to estimate prices for produce |

## Scraper output contract

Each scraper returns `dict | None`:

```python
{
  "store": "maxi" | "costco",
  "product_name": str,
  "brand": str | None,
  "price": float,
  "product_url": str,
  "image_url": str | None,   # HEAD-verified before set
  "format_qty": float,        # e.g. 200 for "200 g"
  "format_unit": str,         # "g" | "kg" | "ml" | "l" | "unite"
  "package_size_raw": str,    # "200 g, 2,50$/100g" (display only)
  # From OpenFoodFacts (best-effort):
  "calories": float | None,
  "proteins": float | None,
  "carbs": float | None,
  "lipids": float | None,
  "nutriscore": "A" | "B" | ... | None,
}
```

## Image resolution (V3)

**Why this was hard** : Maxi's search tiles use lazy-loaded `<img>` that
often point to the search page URL itself (not the product image). Direct
DOM scraping yields noise.

**Solution** : deterministic Loblaws CDN pattern from the SKU, HEAD-verified.

1. Parse SKU from `product_url` via regex: `/p/(\d{9,13})(?:_\w+)?`
2. Generate 4 candidate URLs:
   ```
   assets.shop.loblaws.ca/products/{SKU}/b1/en/front/{SKU}_front_a01_@2.png
   assets.shop.loblaws.ca/products/{SKU}/b2/fr/front/{SKU}_front_a01_@2.png
   assets.shop.loblaws.ca/products/{SKU}/b1/en/front/{SKU}_front_a1a.png
   assets.shop.loblaws.ca/products/{SKU}/b1/en/front/{SKU}_front_a1c1.png
   ```
3. HEAD-check each with a 4 s timeout. First 200 with `content-type: image/*` wins.
4. Cache the result per-SKU for the process lifetime (`_IMAGE_URL_CACHE`).
5. If all 4 fail → try DOM `<img src>` if it looks like a real image.
6. If still nothing → try OpenFoodFacts search API (up to 10 candidate products).
7. If nothing → `image_url = None`, card falls back to the category emoji.

**⚠ Rule enforced in V3** : an ingredient is marked `price_mapping_status =
"mapped"` **only if `image_url` is populated**. Otherwise it stays `pending`
for retry. This prevents "Mappé ✓" cards without a photo.

See `workers/map_prices.py:259`.

## Gemini validation

`ai/classifier.py::validate_store_matches()` scores each (canonical,
product_name) pair 0.0–1.0 in batches of 30. Threshold 0.75. Typical
scores observed:

| pair | score |
|---|---|
| `beurre` / `Beurre salé Lactantia` | 0.95 |
| `beurre` / `Beurre végétal à l'ail` | 0.15 (rejected) |
| `oeufs` / `Oeufs Moyens Cat. A` | 1.00 |

On network failure (401, 429, timeout) the function returns the fallback
score **0.5** — below the threshold, so the product is **not** persisted.
This is intentional: better miss a price than store a wrong match.

## Unit-adaptive price display

`routers/ingredients.py::_unit_price()` converts the product's format into
a unit price for the card :

| `format_unit` | Display |
|---|---|
| `g`, `kg` | `price / kg` |
| `ml`, `l` | `price / L` |
| anything else (`unite`, `gousse`, `feuille`…) | `price / unite` |

e.g. `5.00 $` for 200 g → `25.00 $/kg` — shown under the thumbnail on every
ingredient card.

## Count → mass conversion (recipe side)

When a recipe calls for "12 abricots" but Maxi sells by mass, the batch
generator uses a lookup table `unit_converter.WEIGHT_PER_UNIT_G` (40+
common items: `oeuf=60`, `gousse_ail=5`, `abricot_sec=8`…) to convert the
count to grams. This fixes the "12 abricots → 48 abricots displayed" bug.

See `services/unit_converter.py::convert_count_to_mass()` and its usage in
`services/batch_generator.py::_compute_shopping_row`.

## Freshness tracking

Each `store_product` has `last_checked_at`. An ingredient is **stale** if
its freshest `last_checked_at < now() - PRICE_STALE_DAYS` (default 14).
Exposed through:

- `/api/ingredients?freshness=fresh|stale|missing`
- `/api/ingredients/price-coverage` (aggregate stats)
- Dashboard card + ingredient list badge

## Speed

Observed: **~16 s / ingredient** end-to-end (Maxi + Costco + Gemini + OFF).
ETA for full 15 389 ingredient backfill: ~2 days 20 h.

See `/api/ingredients/pricing-eta` for live estimate.
