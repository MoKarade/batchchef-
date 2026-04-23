"""Enrich every IngredientMaster with a Gemini-vetted search_query.

What it does for each non-mapped ingredient:

  a) Build a normalized "search_query" string that the Maxi scraper will
     actually use. The query is the CLEANEST possible form suitable for a
     grocery search (eg. "huile d'olive" instead of "huile_olive").
  b) If the name is obviously NOT a real grocery ingredient (measurement
     fragments, packaging, vague terms like "au_gout"), mark the row
     `price_mapping_status = 'invalid'` so the worker never wastes time
     scraping it.
  c) Otherwise set `price_mapping_status = 'pending'` (ready for scrape)
     and fill `display_name_fr` with the grocery-search form — the worker
     already prefers display_name_fr as its first query.

The Gemini call is batched 40 items / request. Each item returns:
  { "valid": true/false, "query": "huile d'olive", "category": "condiment" }

Run:  uv run python scripts/categorize_and_query.py [--limit=500] [--dry]
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select, update, func
from sqlalchemy.orm import selectinload

from app.database import AsyncSessionLocal, init_db
from app.models.ingredient import IngredientMaster
from app.models.recipe import RecipeIngredient
from app.ai.client import call_claude
from app.ai.utils import parse_json_response

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

BATCH = 40
DRY = "--dry" in sys.argv
LIMIT = next(
    (int(a.split("=", 1)[1]) for a in sys.argv if a.startswith("--limit=")),
    None,
)

SYSTEM = """Pour chaque mot-clé d'ingrédient reçu, décide:
  - "valid": true si c'est un ingrédient achetable en épicerie; false si c'est un
    fragment de mesure, un emballage seul, ou un mot vide (ex: "au_gout", "a_soupe").
  - "query": la requête de recherche à utiliser sur un site d'épicerie — en français
    québécois, minuscules, sans underscore, sans accent bizarre, forme la plus simple
    que l'étagère de l'épicerie comprendrait (ex: "huile d'olive", "lait", "poulet").
  - "category": une des catégories: "fruit", "legume", "viande", "poisson", "produit_laitier",
    "cereale", "epice", "condiment", "boisson", "noix", "conserve", "autre".

Règles strictes:
  * Si non-ingrédient ("au_goût", "à_soupe_de", "es") → valid=false, query="", category="autre"
  * Si nom composé ("sel_et_poivre") → prends le premier ingrédient réel → valid=true, query="sel"
  * Si mot tronqué identifiable (ex: "eurre" manque le "b") → valid=true, query="beurre"
  * Garde les accents dans "query" ("crème", "pâtes")
  * "query" doit être <= 40 caractères

Réponds UNIQUEMENT avec un JSON array d'objets, dans le même ordre que l'input."""


async def classify_batch(names: list[str]) -> list[dict]:
    user = f"Input: {json.dumps(names, ensure_ascii=False)}"
    for attempt in range(3):
        try:
            text = await call_claude(SYSTEM, user)
            parsed = parse_json_response(text)
            if isinstance(parsed, list) and len(parsed) == len(names):
                return [p if isinstance(p, dict) else {} for p in parsed]
            raise ValueError(f"len mismatch {len(parsed)} vs {len(names)}")
        except Exception as e:
            if attempt < 2:
                await asyncio.sleep(5 * (2 ** attempt))
                logging.warning(f"classify batch retry ({e})")
            else:
                logging.warning(f"classify batch failed: {e}")
    return [{}] * len(names)


async def main():
    await init_db()

    # Pick the non-mapped ingredients, ordered by usage so the most-used
    # staples get normalized first.
    async with AsyncSessionLocal() as db:
        q = (
            select(IngredientMaster.id, IngredientMaster.canonical_name,
                   func.count(RecipeIngredient.id).label("uses"))
            .outerjoin(RecipeIngredient, RecipeIngredient.ingredient_master_id == IngredientMaster.id)
            .where(IngredientMaster.price_mapping_status != "mapped")
            .group_by(IngredientMaster.id)
            .order_by(func.count(RecipeIngredient.id).desc())
        )
        if LIMIT:
            q = q.limit(LIMIT)
        rows = (await db.execute(q)).all()
    logging.info(f"loaded {len(rows)} candidates")

    total = len(rows)
    processed = 0
    invalid = 0
    updated = 0

    for start in range(0, total, BATCH):
        chunk = rows[start : start + BATCH]
        names = [r[1] for r in chunk]
        results = await classify_batch(names)

        if DRY:
            for (iid, cn, uses), r in zip(chunk, results):
                print(f"  [{uses:>4}]  {cn[:40]:40s}  valid={r.get('valid')}  q='{r.get('query','')[:40]}'  cat={r.get('category')}")
        else:
            async with AsyncSessionLocal() as db:
                for (iid, cn, uses), r in zip(chunk, results):
                    if not isinstance(r, dict):
                        continue
                    if r.get("valid") is False:
                        await db.execute(update(IngredientMaster).where(IngredientMaster.id == iid).values(
                            price_mapping_status="invalid",
                        ))
                        invalid += 1
                    else:
                        query = (r.get("query") or "").strip()
                        cat = (r.get("category") or "").strip() or None
                        values: dict = {"price_mapping_status": "pending"}
                        if query:
                            values["display_name_fr"] = query
                        if cat:
                            values["category"] = cat
                        await db.execute(update(IngredientMaster).where(IngredientMaster.id == iid).values(**values))
                        updated += 1
                await db.commit()

        processed += len(chunk)
        logging.info(f"progress {processed}/{total}  invalid={invalid}  updated={updated}")

    logging.info(f"done. invalid={invalid}  updated={updated}  total={total}")


if __name__ == "__main__":
    asyncio.run(main())
