"""
Celery task: AI-estimate Fruiterie 440 prices for all IngredientMaster rows.
Batches 30 names / Gemini request.
"""
import asyncio
import json
import logging
from app.utils.time import utcnow

from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)

AI_BATCH = 30


@celery_app.task(bind=True, name="prices.estimate_fruiterie")
def run_estimate_fruiterie(self, job_id: int, ingredient_ids: list[int] | None = None):
    asyncio.run(_run(job_id, ingredient_ids))


async def _run(job_id: int, ingredient_ids: list[int] | None):
    from sqlalchemy import select
    from app.database import AsyncSessionLocal, init_db
    from app.models.job import ImportJob
    from app.models.ingredient import IngredientMaster
    from app.models.store import Store, StoreProduct
    from app.ai.price_estimator import estimate_prices_batch
    from app.websocket.manager import manager

    await init_db()

    async with AsyncSessionLocal() as db:
        job = await db.get(ImportJob, job_id)
        if not job:
            return
        job.status = "running"
        job.started_at = utcnow()
        await db.commit()

        store = (await db.execute(select(Store).where(Store.code == "fruiterie_440"))).scalar_one_or_none()
        if not store:
            job.status = "failed"
            job.error_log = json.dumps(["Store fruiterie_440 introuvable"])
            job.finished_at = utcnow()
            await db.commit()
            await manager.broadcast(str(job_id), {"job_id": job_id, "status": "failed"})
            return

        q = select(IngredientMaster).where(IngredientMaster.is_produce.is_(True))
        if ingredient_ids:
            q = q.where(IngredientMaster.id.in_(ingredient_ids))
        ingredients = list((await db.execute(q)).scalars().all())
        job.progress_total = len(ingredients)
        await db.commit()

    total = len(ingredients)
    processed = 0
    errors: list[str] = []
    cancelled = False

    await manager.broadcast(str(job_id), {
        "job_id": job_id,
        "current": 0,
        "total": total,
        "processed": 0,
        "errors": 0,
        "status": "running",
    })

    for chunk_start in range(0, total, AI_BATCH):
        async with AsyncSessionLocal() as db:
            job = await db.get(ImportJob, job_id)
            if job and job.cancel_requested:
                cancelled = True
                break

        chunk = ingredients[chunk_start: chunk_start + AI_BATCH]
        names = [ing.canonical_name for ing in chunk]

        try:
            estimates = await estimate_prices_batch(names)
        except Exception as e:
            errors.append(f"batch@{chunk_start}: {e}")
            estimates = []

        by_name = {e["canonical_name"]: e for e in estimates}

        async with AsyncSessionLocal() as db:
            for ing in chunk:
                est = by_name.get(ing.canonical_name)
                if not est:
                    errors.append(f"miss: {ing.canonical_name}")
                    continue

                sp_q = select(StoreProduct).where(
                    StoreProduct.ingredient_master_id == ing.id,
                    StoreProduct.store_id == store.id,
                )
                product = (await db.execute(sp_q)).scalars().first()
                if product and product.is_validated:
                    # Never overwrite a manually-validated price
                    processed += 1
                    continue
                if not product:
                    product = StoreProduct(
                        ingredient_master_id=ing.id,
                        store_id=store.id,
                    )
                    db.add(product)

                product.price = est["price"]
                product.format_qty = est["format_qty"]
                product.format_unit = est["unit"]
                product.product_name = ing.display_name_fr or ing.canonical_name.replace("_", " ").title()
                product.is_validated = False
                product.confidence_score = est["confidence"]
                product.last_checked_at = utcnow()
                processed += 1
            await db.commit()

        async with AsyncSessionLocal() as db:
            job = await db.get(ImportJob, job_id)
            if job:
                job.progress_current = min(chunk_start + len(chunk), total)
                job.current_item = chunk[-1].canonical_name if chunk else None
                await db.commit()

        await manager.broadcast(str(job_id), {
            "job_id": job_id,
            "current": min(chunk_start + len(chunk), total),
            "total": total,
            "processed": processed,
            "errors": len(errors),
        })

    final_status = "cancelled" if cancelled else "completed"

    async with AsyncSessionLocal() as db:
        job = await db.get(ImportJob, job_id)
        if job:
            job.status = final_status
            job.finished_at = utcnow()
            if not cancelled:
                job.progress_current = total
            job.error_log = json.dumps(errors[:200])
            await db.commit()

    await manager.broadcast(str(job_id), {
        "job_id": job_id,
        "status": final_status,
        "processed": processed,
        "errors": len(errors),
    })
