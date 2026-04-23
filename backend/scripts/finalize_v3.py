"""Finalize the V3 pipeline in two phases: (1) price every canonical parent
via the Maxi scraper, (2) regate every recipe based on parent coverage.

Idempotent. Can be run multiple times — Phase 1 skips already-mapped parents
and Phase 2 overwrites recipe.pricing_status from scratch every time.

Usage:
    uv run python scripts/finalize_v3.py              # both phases
    uv run python scripts/finalize_v3.py --map-only   # only scrape prices
    uv run python scripts/finalize_v3.py --gate-only  # only regate recipes

Run from the backend/ directory (or anywhere — the script fixes sys.path).
"""
from __future__ import annotations

import asyncio
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select, update, func
from sqlalchemy.orm import selectinload

from app.database import AsyncSessionLocal, init_db
from app.models.ingredient import IngredientMaster
from app.models.recipe import Recipe, RecipeIngredient
from app.models.store import StoreProduct
from app.models.job import ImportJob
from app.utils.time import utcnow

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("finalize_v3")


# ---------------------------------------------------------------------------
# Phase 1: price parents via Maxi
# ---------------------------------------------------------------------------

async def phase_map_prices() -> None:
    """Invoke map_prices._run() directly with a fresh ImportJob."""
    from app.workers.map_prices import _run as map_prices_run

    async with AsyncSessionLocal() as db:
        job = ImportJob(
            job_type="price_mapping",
            status="queued",
            progress_total=0,
            metadata_json=json.dumps({
                "source": "finalize_v3",
                "store_codes": ["maxi"],
                "ingredient_ids": None,
            }),
        )
        db.add(job)
        await db.commit()
        await db.refresh(job)
        job_id = job.id

    log.info(f"Phase 1: map_prices job={job_id} starting (Maxi, parents only)")
    try:
        await map_prices_run(job_id, ["maxi"], None)
        log.info(f"Phase 1: map_prices job={job_id} done")
    except Exception as e:
        log.error(f"Phase 1 failed: {e}")
        async with AsyncSessionLocal() as db:
            j = await db.get(ImportJob, job_id)
            if j:
                j.status = "failed"
                j.finished_at = utcnow()
                j.error_log = json.dumps([str(e)])
                await db.commit()
        raise


# ---------------------------------------------------------------------------
# Phase 2: regate recipes
# ---------------------------------------------------------------------------

async def phase_regate_recipes() -> dict:
    """Mark each recipe complete/incomplete based on canonical parent coverage.

    Rules:
      * A recipe is complete iff every RecipeIngredient's *effective*
        ingredient (parent if variant, else self) is either mapped or
        invalid in the IngredientMaster table.
      * Invalid ingredients don't count as missing — they're dropped entirely.
      * Variants roll up to their parent for the coverage check.
    """
    async with AsyncSessionLocal() as db:
        # 1) Build set of unpriced canonical parents
        unpriced_q = (
            select(IngredientMaster.id)
            .where(IngredientMaster.parent_id.is_(None))
            .where(IngredientMaster.price_mapping_status != "invalid")
            .where(
                ~select(StoreProduct.id)
                .where(StoreProduct.ingredient_master_id == IngredientMaster.id)
                .where(StoreProduct.price.is_not(None))
                .exists()
            )
        )
        unpriced_ids = {r[0] for r in (await db.execute(unpriced_q)).all()}
        log.info(f"Phase 2: {len(unpriced_ids)} canonical parents still unpriced")

        # 2) Load all recipes with their RecipeIngredients + IngredientMaster
        recipes_q = (
            select(Recipe)
            .options(selectinload(Recipe.ingredients).selectinload(RecipeIngredient.ingredient))
        )
        recipes = list((await db.execute(recipes_q)).scalars().all())
        log.info(f"Phase 2: regating {len(recipes)} recipes")

        complete = 0
        incomplete = 0
        pending_because_empty = 0

        for recipe in recipes:
            if not recipe.ingredients:
                recipe.pricing_status = "pending"
                pending_because_empty += 1
                continue
            missing: list[str] = []
            for ri in recipe.ingredients:
                if not ri.ingredient_master_id:
                    continue
                master = ri.ingredient
                if master and master.price_mapping_status == "invalid":
                    continue
                # Resolve to parent for variants
                check_id = (
                    master.parent_id
                    if master and master.parent_id
                    else ri.ingredient_master_id
                )
                if check_id in unpriced_ids:
                    name = master.canonical_name if master else str(ri.ingredient_master_id)
                    if name not in missing:
                        missing.append(name)
            if missing:
                recipe.pricing_status = "incomplete"
                recipe.missing_price_ingredients = missing
                incomplete += 1
            else:
                recipe.pricing_status = "complete"
                recipe.missing_price_ingredients = None
                complete += 1

        await db.commit()

    summary = {
        "complete": complete,
        "incomplete": incomplete,
        "pending_because_empty": pending_because_empty,
        "total": len(recipes),
        "unpriced_parents": len(unpriced_ids),
    }
    log.info(f"Phase 2 summary: {summary}")
    return summary


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

async def main():
    map_only = "--map-only" in sys.argv
    gate_only = "--gate-only" in sys.argv

    if map_only and gate_only:
        log.error("--map-only and --gate-only are mutually exclusive")
        return 2

    await init_db()

    if not gate_only:
        await phase_map_prices()
    if not map_only:
        summary = await phase_regate_recipes()
        log.info(f"Final: {summary['complete']}/{summary['total']} recipes complete, "
                 f"{summary['incomplete']} incomplete "
                 f"({summary['unpriced_parents']} parents still unpriced)")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
