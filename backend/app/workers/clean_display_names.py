"""Celery task: re-sanitize corrupted IngredientMaster.display_name_fr via Gemini.

Fixes entries like "Ousses D'Ail", "S De Safran", "À Soupe D'Huile D'Olive"
left behind by the Marmiton parser eating the first character of words.

Heuristic for "corrupted": the display contains Title-Case words with lone
apostrophes or absurdly long compound names. To be safe, we process all
display names (Gemini no-ops on already-clean inputs per the prompt).
"""
import asyncio
import json
import logging
from app.utils.time import utcnow

from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)

AI_BATCH = 40


@celery_app.task(bind=True, name="ingredients.clean_display_names")
def run_clean_display_names(self, job_id: int, ingredient_ids: list[int] | None = None):
    asyncio.run(_run(job_id, ingredient_ids))


async def _run(job_id: int, ingredient_ids: list[int] | None):
    from sqlalchemy import select
    from app.database import AsyncSessionLocal, init_db
    from app.models.job import ImportJob
    from app.models.ingredient import IngredientMaster
    from app.ai.display_name_cleaner import clean_display_names
    from app.websocket.manager import manager

    await init_db()

    async with AsyncSessionLocal() as db:
        job = await db.get(ImportJob, job_id)
        if not job:
            return
        job.status = "running"
        job.started_at = utcnow()

        q = select(IngredientMaster)
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
        "job_id": job_id, "current": 0, "total": total, "status": "running",
    })

    for chunk_start in range(0, total, AI_BATCH):
        async with AsyncSessionLocal() as db:
            job = await db.get(ImportJob, job_id)
            if job and job.cancel_requested:
                cancelled = True
                break

        chunk = ingredients[chunk_start: chunk_start + AI_BATCH]
        pairs = [(ing.canonical_name, ing.display_name_fr) for ing in chunk]

        try:
            cleaned = await clean_display_names(pairs)
        except Exception as e:
            errors.append(f"batch@{chunk_start}: {e}")
            cleaned = [d for _, d in pairs]

        async with AsyncSessionLocal() as db:
            for ing, new_name in zip(chunk, cleaned):
                if new_name and new_name != ing.display_name_fr:
                    fresh = await db.get(IngredientMaster, ing.id)
                    if fresh:
                        fresh.display_name_fr = new_name
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
        "job_id": job_id, "status": final_status, "processed": processed, "errors": len(errors),
    })
