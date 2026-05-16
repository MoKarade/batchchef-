"""
Celery task: retry price mapping for ingredients with no Maxi/Costco price.
Runs daily via Celery beat. Selects ingredients with price_mapping_status != 'mapped'
and price_map_attempts < 5. Generates fresh aliases if previous ones failed, then
re-scrapes Maxi + Costco. After 5 failures, marks status 'failed'.
"""
import asyncio
import logging

from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 5
BATCH_LIMIT = 100  # max ingredients per retry run


@celery_app.task(bind=True, name="prices.retry_missing")
def run_retry_missing_prices(self):
    asyncio.run(_run())


async def _run():
    from sqlalchemy import select, or_
    from app.database import AsyncSessionLocal, init_db
    from app.models.ingredient import IngredientMaster
    from app.models.job import ImportJob
    from app.workers.map_prices import run_price_mapping
    import json

    await init_db()

    async with AsyncSessionLocal() as db:
        q = (
            select(IngredientMaster)
            .where(
                or_(
                    IngredientMaster.price_mapping_status == "pending",
                    IngredientMaster.price_mapping_status == "failed_retry",
                ),
                IngredientMaster.price_map_attempts < MAX_ATTEMPTS,
            )
            .limit(BATCH_LIMIT)
        )
        candidates = list((await db.execute(q)).scalars().all())

    if not candidates:
        logger.info("retry_missing_prices: nothing to retry")
        return

    ids = [ing.id for ing in candidates]
    logger.info(f"retry_missing_prices: retrying {len(ids)} ingredients")

    # Regenerate aliases for ingredients that have exhausted previous ones
    needs_fresh = [ing for ing in candidates if not ing.search_aliases]
    if needs_fresh:
        from app.workers.import_marmiton import _generate_aliases_for_ingredients
        await _generate_aliases_for_ingredients([ing.id for ing in needs_fresh])

    # Queue a price mapping job scoped to these ingredients
    async with AsyncSessionLocal() as db:
        job = ImportJob(
            job_type="price_mapping_retry",
            status="queued",
            progress_total=len(ids) * 2,
            metadata_json=json.dumps({"ingredient_ids": ids}),
        )
        db.add(job)
        await db.commit()
        job_id = job.id

    run_price_mapping.delay(job_id, ["maxi", "costco"], ids)
    logger.info(f"retry_missing_prices: dispatched job {job_id} for {len(ids)} ingredients")

    # Mark ingredients that hit MAX_ATTEMPTS as permanently failed
    async with AsyncSessionLocal() as db:
        for ing_id in ids:
            ing = await db.get(IngredientMaster, ing_id)
            if ing and (ing.price_map_attempts or 0) >= MAX_ATTEMPTS - 1:
                ing.price_mapping_status = "failed"
        await db.commit()
