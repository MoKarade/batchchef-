"""
Celery task: retroactively classify recipes that are in 'scraped' status
(no AI tags or health_score yet).
"""
import asyncio
import json
import logging
from datetime import datetime

from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)

BATCH_SIZE = 10  # recipes per classification batch


@celery_app.task(bind=True, name="classify_recipes.run")
def run_classify_recipes(self, job_id: int, recipe_ids: list[int] | None = None):
    asyncio.run(_run(job_id, recipe_ids))


async def _run(job_id: int, recipe_ids: list[int] | None):
    from sqlalchemy import select
    from app.database import AsyncSessionLocal, init_db
    from app.models.job import ImportJob
    from app.models.recipe import Recipe
    from app.ai.classifier import classify_recipe
    from app.websocket.manager import manager

    await init_db()

    async with AsyncSessionLocal() as db:
        job = await db.get(ImportJob, job_id)
        if not job:
            return

        if recipe_ids:
            q = select(Recipe).where(Recipe.id.in_(recipe_ids))
        else:
            q = select(Recipe).where(Recipe.status == "scraped")
        recipes = (await db.execute(q)).scalars().all()
        total = len(recipes)

        job.status = "running"
        job.started_at = datetime.utcnow()
        job.progress_total = total
        job.progress_current = 0
        await db.commit()

    await manager.broadcast(str(job_id), {
        "job_id": job_id, "current": 0, "total": total, "status": "running",
    })

    done = 0
    errors: list[str] = []

    for recipe in recipes:
        # Cooperative cancellation
        async with AsyncSessionLocal() as db:
            job = await db.get(ImportJob, job_id)
            if job and job.cancel_requested:
                break

        try:
            # Build ingredient list from existing RecipeIngredients
            async with AsyncSessionLocal() as db:
                r = await db.get(Recipe, recipe.id)
                if not r:
                    continue

                # Load related ingredients for context
                from sqlalchemy.orm import selectinload
                from app.models.recipe import RecipeIngredient
                q2 = (
                    select(Recipe)
                    .options(selectinload(Recipe.ingredients).selectinload(RecipeIngredient.ingredient))
                    .where(Recipe.id == r.id)
                )
                r_full = (await db.execute(q2)).scalar_one_or_none()
                if not r_full:
                    continue

                ingredients_text = ", ".join(
                    (ri.ingredient.canonical_name if ri.ingredient else ri.raw_text or "")
                    for ri in r_full.ingredients
                    if ri.ingredient or ri.raw_text
                )

                cls = await classify_recipe(r_full.title, ingredients_text)
                if cls:
                    r_full.meal_type = cls.get("meal_type", r_full.meal_type)
                    r_full.is_sweet = bool(cls.get("is_sweet", r_full.is_sweet))
                    r_full.is_salty = bool(cls.get("is_salty", r_full.is_salty))
                    r_full.is_spicy = bool(cls.get("is_spicy", r_full.is_spicy))
                    r_full.is_vegetarian = bool(cls.get("is_vegetarian", r_full.is_vegetarian))
                    r_full.is_vegan = bool(cls.get("is_vegan", r_full.is_vegan))
                    r_full.cuisine_type = cls.get("cuisine_type", r_full.cuisine_type)
                    if cls.get("tags"):
                        r_full.tags_json = json.dumps(cls["tags"], ensure_ascii=False)
                    if cls.get("health_score") is not None:
                        r_full.health_score = float(cls["health_score"])
                    r_full.status = "ai_done"
                    r_full.ai_processed_at = datetime.utcnow()
                    await db.commit()

        except Exception as e:
            errors.append(f"Recipe {recipe.id}: {e}")
            logger.warning(f"Classify error recipe {recipe.id}: {e}")

        done += 1
        await manager.broadcast(str(job_id), {
            "job_id": job_id, "current": done, "total": total,
            "current_item": recipe.title, "status": "running",
        })

        async with AsyncSessionLocal() as db:
            job = await db.get(ImportJob, job_id)
            if job:
                job.progress_current = done
                await db.commit()

    async with AsyncSessionLocal() as db:
        job = await db.get(ImportJob, job_id)
        if job:
            job.status = "completed"
            job.finished_at = datetime.utcnow()
            job.progress_current = done
            job.error_log = json.dumps(errors[:50])
            await db.commit()

    await manager.broadcast(str(job_id), {
        "job_id": job_id, "status": "completed", "current": done, "total": total,
    })
